import { access, constants, readdir, readFile } from 'node:fs/promises'
import { join, parse } from 'node:path/posix'
import { arch } from 'node:process'
import { getPreferenceValues } from '@raycast/api'
import { clean } from 'semver'
import { execPromise, getAllDirs, getFirstFlatItem, isFile, toWindowsPath } from '../logic'

/**
 * Scoop manifest checkver configuration
 * Can be either a regex string, "github", or a complex configuration object
 */
type CheckverConfig
  = | string // Direct regex string or "github"
    | {
      // Source type options - typically only one is used
      github?: string // GitHub repository URL
      sourceforge?: string // SourceForge project name
      url?: string // Custom URL

      // Source path configuration
      sourceforgepath?: string // SourceForge path

      // Extraction methods - can be combined
      regex?: string // Regular expression
      re?: string // Regex alias
      jsonpath?: string // JSONPath expression
      jp?: string // JSONPath alias
      xpath?: string // XPath expression

      // Result processing
      replace?: string // Replace matching value
      reverse?: boolean // Match last occurrence instead of first

      // Request configuration
      userAgent?: string // Custom User-Agent

      // Complex scripting
      script?: string | string[] // PowerShell commands
    }

export interface AppInfo {
  appName: string
  dirPath: string
  version: string
  description: string
  exeName: string
  homepage: string
  checkver: CheckverConfig
  bucket: string
}

export interface AvailableAppInfo {
  appName: string
  description: string
  version: string
  homepage: string
  bucket: string
  installed: boolean
}

export class Scoop {
  private scoopRoot: string

  constructor() {
    const settings = getPreferenceValues<{ scoopRoot: string }>()
    this.scoopRoot = settings.scoopRoot.trim() || ''
  }

  // 添加获取 Scoop 根目录的方法
  getScoopRoot(): string {
    return this.scoopRoot
  }

  private async isValidScoopRoot(): Promise<boolean> {
    if (!this.scoopRoot) {
      return false
    }

    try {
      await access(this.scoopRoot, constants.F_OK)
      await access(`${this.scoopRoot}/apps`, constants.F_OK)
      return true
    }
    catch {
      return false
    }
  }

  /**
   * Extract executable path from Scoop app manifest
   * Looks for shortcuts, bin entries, and architecture-specific entries
   */
  private getAppExeFromManifest(manifestContent: any): string {
    if (manifestContent.shortcuts) {
      const firstShortcut = getFirstFlatItem(manifestContent.shortcuts)
      if (typeof firstShortcut === 'string') {
        return firstShortcut
      }
    }

    if (manifestContent.bin) {
      const firstBin = getFirstFlatItem(manifestContent.bin)
      if (typeof firstBin === 'string') {
        return firstBin
      }
    }

    if (manifestContent.architecture) {
      const processArch = arch === 'x64'
        ? '64bit'
        : arch === 'ia32'
          ? '32bit'
          : arch === 'arm64'
            ? 'arm64'
            : 'unknown'

      const archConfig = manifestContent.architecture[processArch]
      if (!archConfig) {
        return ''
      }

      if (archConfig.shortcuts) {
        const firstShortcut = getFirstFlatItem(archConfig.shortcuts)
        if (typeof firstShortcut === 'string') {
          return firstShortcut
        }
      }

      if (archConfig.bin) {
        const firstBin = getFirstFlatItem(archConfig.bin)
        if (typeof firstBin === 'string') {
          return firstBin
        }
      }
    }

    return ''
  }

  /**
   * Check for new version of an app
   * Returns cleaned version string without 'v' prefix
   */
  async checkNewVersion(app: AppInfo): Promise<string> {
    const format = (rawVersion: string) => {
      return clean(rawVersion) || ''
    }

    const _checkNewVersion = async (app: AppInfo): Promise<string> => {
      const checkver = app.checkver
      const homepage = app.homepage

      if (typeof checkver === 'string') {
        if (checkver === 'github') {
          const repo = homepage.replace(/https?:\/\/(www\.)?github\.com\//, '')
          const apiUrl = `https://api.github.com/repos/${repo}/releases`
          const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
          })
          const releases = await response.json() as Array<any>
          const latest = releases.find((release: any) => !release.prerelease)
          return latest?.tag_name ?? ''
        }

        // checkver is RegExp string
        const reg = new RegExp(checkver, 'g')
        const response = await fetch(homepage, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
        const content = await response.text()
        const matches = [...content.matchAll(reg)]
        if (matches.length === 0) {
          return ''
        }
        const match = matches[0]
        return match[1] ?? match[0] ?? ''
      }
      else if (typeof checkver === 'object' && checkver !== null) {
        if (checkver.script) {
          // skip when need to run a script
          return ''
        }

        if (checkver.github) {
          const repo = checkver.github.replace(/https?:\/\/(www\.)?github\.com\//, '')
          const apiUrl = `https://api.github.com/repos/${repo}/releases`
          const response = await fetch(apiUrl, {
            headers: { 'User-Agent': checkver.userAgent || 'Mozilla/5.0' },
          })
          const releases = await response.json() as Array<any>
          const latest = releases.find((release: any) => !release.prerelease)
          if (checkver.regex) {
            const reg = new RegExp(checkver.regex, 'g')
            const matches = [...JSON.stringify(latest).matchAll(reg)]
            if (matches.length === 0) {
              return ''
            }
            const match = matches[0]
            if (checkver.replace) {
              let replaced = checkver.replace
              if (match.groups) {
                for (const key in match.groups) {
                  replaced = replaced.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), match.groups[key])
                }
              }
              return replaced
            }
            return match[1] ?? match[0] ?? ''
          }
          return latest?.tag_name ?? ''
        }

        if (checkver.sourceforge) {
          let rssUrl = `https://sourceforge.net/projects/${checkver.sourceforge}/rss`
          if (checkver.sourceforgepath) {
            rssUrl += `?path=${checkver.sourceforgepath.replace(/^\//, '')}`
          }
          const response = await fetch(rssUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
          })
          const xml = await response.text()
          const match = xml.match(/<link>(.*?)<\/link>/)
          if (match && (checkver.regex || checkver.re)) {
            const reg = new RegExp(checkver.regex || checkver.re!)
            const verMatch = match[1].match(reg)
            return verMatch ? verMatch[1].replace(/^v/, '') : ''
          }
          return match ? match[1] : ''
        }

        if (checkver.url) {
          const response = await fetch(checkver.url, {
            headers: { 'User-Agent': checkver.userAgent || 'Mozilla/5.0' },
          })
          const content = await response.text()
          if (checkver.regex || checkver.re) {
            const reg = new RegExp(checkver.regex || checkver.re!, 'g')
            const matches = [...content.matchAll(reg)]

            if (matches.length === 0) {
              return ''
            }
            const match = checkver.reverse ? matches[matches.length - 1] : matches[0]
            if (checkver.replace) {
              let replaced = checkver.replace
              if (match.groups) {
                for (const key in match.groups) {
                  replaced = replaced.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), match.groups[key])
                }
              }
              return replaced
            }
            return match[1] ?? match[0] ?? ''
          }
        }
      }

      return ''
    }

    try {
      return format(await _checkNewVersion(app))
    }
    catch {
      // return '' means failed to check version
      return ''
    }
  }

  async getAppInfo(appName: string): Promise<AppInfo | null> {
    const scoopAppsPath = join(this.scoopRoot, 'apps')
    const appDirPath = join(scoopAppsPath, appName, 'current')
    const manifestPath = join(appDirPath, 'manifest.json')
    const installPath = join(appDirPath, 'install.json')

    try {
      const manifestContent = JSON.parse(await readFile(manifestPath, 'utf-8'))
      const installContent = JSON.parse(await readFile(installPath, 'utf-8'))

      const version: string = manifestContent.version
      const description: string = Array.isArray(manifestContent.description)
        ? manifestContent.description[0]
        : manifestContent.description
      const homepage: string = manifestContent.homepage || ''
      const checkver: CheckverConfig = manifestContent.checkver || { url: '', regex: '' }
      const bucket: string = installContent.bucket || 'unknown'
      const exeName = this.getAppExeFromManifest(manifestContent)

      return {
        appName,
        dirPath: appDirPath,
        version,
        description,
        exeName,
        homepage,
        checkver,
        bucket,
      }
    }
    catch {
      return null
    }
  }

  async updateNewVersion(app: AppInfo) {
    try {
      await execPromise(`scoop update ${app.bucket}/${app.appName}`)
    }
    catch (error) {
      throw new Error(`无法更新应用 ${app.appName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async uninstallApp(app: { appName: string, bucket: string }) {
    try {
      await execPromise(`scoop uninstall ${app.bucket}/${app.appName}`)
    }
    catch (error) {
      throw new Error(`无法卸载应用 ${app.appName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async resetApp(app: AppInfo) {
    try {
      await execPromise(`scoop reset ${app.bucket}/${app.appName}`)
    }
    catch (error) {
      throw new Error(`无法重置应用 ${app.appName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async installApp(bucket: string, appName: string) {
    try {
      await execPromise(`scoop install ${bucket}/${appName}`)
    }
    catch (error) {
      throw new Error(`Failed to install app ${appName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async getScoopList() {
    if (!await this.isValidScoopRoot()) {
      throw new Error('Scoop root is invalid or not set.')
    }

    // get all the dir in the scoopAppsPath
    const scoopAppsPath = join(this.scoopRoot, 'apps')
    let appDirNameArr: string[] = []
    try {
      appDirNameArr = await getAllDirs(scoopAppsPath)
    }
    catch {
      throw new Error('Failed to read Scoop apps directory.')
    }

    if (appDirNameArr.length === 0) {
      throw new Error('No Scoop apps found.')
    }

    const appList = await Promise.all(
      appDirNameArr.map(appName => this.getAppInfo(appName)),
    )
    return appList.filter(Boolean) as AppInfo[]
  }

  async getInstalledApps(): Promise<Set<string>> {
    try {
      const installedAppsList = await this.getScoopList()
      return new Set(installedAppsList.map(app => app.appName.toLowerCase()))
    }
    catch {
      return new Set()
    }
  }

  async getAllBuckets(): Promise<string[]> {
    if (!this.scoopRoot)
      throw new Error('Scoop root is not set. Please set it in preferences.')
    const bucketsPath = join(this.scoopRoot, 'buckets')
    try {
      const dirs = await readdir(bucketsPath, { withFileTypes: true })
      return dirs.filter(dir => dir.isDirectory()).map(dir => dir.name)
    }
    catch {
      return []
    }
  }

  async readAppManifest(filePath: string, bucket: string, installedApps: Set<string>): Promise<AvailableAppInfo | null> {
    try {
      let content: string
      try {
        content = await readFile(filePath, 'utf-8')
      }
      catch {
        return null
      }
      let manifest: any
      try {
        manifest = JSON.parse(content)
      }
      catch {
        return null
      }
      const fileName = parse(filePath).name.toLowerCase()
      const description = Array.isArray(manifest.description)
        ? manifest.description[0] || ''
        : manifest.description || ''
      return {
        appName: fileName,
        description: description.trim(),
        version: manifest.version || '',
        homepage: manifest.homepage || '',
        bucket,
        installed: installedApps.has(fileName.toLowerCase()),
      }
    }
    catch {
      return null
    }
  }

  async loadAppsFromBucket(bucketName: string, installedApps: Set<string>): Promise<AvailableAppInfo[]> {
    if (!this.scoopRoot)
      throw new Error('Scoop root is not set. Please set it in preferences.')
    const bucketPath = join(this.scoopRoot, 'buckets', bucketName, 'bucket')
    let files: string[]
    try {
      files = await readdir(bucketPath)
    }
    catch {
      return []
    }
    const jsonFiles = files.filter(file => file.endsWith('.json'))
    if (jsonFiles.length === 0)
      return []
    const BATCH_SIZE = 50
    const apps: AvailableAppInfo[] = []
    for (let i = 0; i < jsonFiles.length; i += BATCH_SIZE) {
      const batch = jsonFiles.slice(i, i + BATCH_SIZE)
      const manifestPromises = batch.map(file => this.readAppManifest(join(bucketPath, file), bucketName, installedApps))
      const results = await Promise.allSettled(manifestPromises)
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value)
          apps.push(result.value)
      })
    }
    return apps
  }
}
