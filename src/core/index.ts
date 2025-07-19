import { access, constants, readFile } from 'node:fs/promises'
import { join } from 'node:path/posix'
import { arch } from 'node:process'
import { getPreferenceValues } from '@raycast/api'
import { clean } from 'semver'
import { execPromise, getAllDirs, getFirstFlatItem, isFile, toWindowsPath } from '../logic'

type CheckverConfig
  // 简单字符串 - 直接正则表达式或 "github"
  = | string
  // 对象配置 - 包含所有可能的属性
    | {
    // 基本源类型 - 通常只使用其中一个
      github?: string // GitHub 仓库 URL
      sourceforge?: string // SourceForge 项目名
      url?: string // 自定义 URL

      // 源相关配置
      sourceforgepath?: string // SourceForge 路径

      // 提取方法 - 可以组合使用
      regex?: string // 正则表达式
      re?: string // regex 别名
      jsonpath?: string // JSONPath 表达式
      jp?: string // jsonpath 别名
      xpath?: string // XPath 表达式

      // 结果处理
      replace?: string // 替换匹配值
      reverse?: boolean // 是否匹配最后一次出现

      // 请求配置
      userAgent?: string // 自定义 User-Agent

      // 复杂脚本
      script?: string | string[] // PowerShell 命令
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

export class Scoop {
  private scoopRoot: string

  constructor() {
    // get scoop root from preferences
    const settings = getPreferenceValues<{ scoopRoot: string }>()
    this.scoopRoot = settings.scoopRoot.trim() || ''
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

  private getAppExeFromManifest(manifestContent: any): string {
    // shortcuts
    if (manifestContent.shortcuts) {
      const firstShortcut = getFirstFlatItem(manifestContent.shortcuts)
      if (typeof firstShortcut === 'string') {
        return firstShortcut
      }
    }

    // bin
    if (manifestContent.bin) {
      const firstBin = getFirstFlatItem(manifestContent.bin)
      if (typeof firstBin === 'string') {
        return firstBin
      }
    }

    // architecture shortcut or bin
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

      // shortcuts
      if (archConfig.shortcuts) {
        const firstShortcut = getFirstFlatItem(archConfig.shortcuts)
        if (typeof firstShortcut === 'string') {
          return firstShortcut
        }
      }

      // bin
      if (archConfig.bin) {
        const firstBin = getFirstFlatItem(archConfig.bin)
        if (typeof firstBin === 'string') {
          return firstBin
        }
      }
    }

    return ''
  }

  // should not return "v" prefix
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
        // 返回第一个捕获组（如果存在），否则返回整个匹配
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

    return format(await _checkNewVersion(app))
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
    await execPromise(`scoop update ${app.bucket}/${app.appName}`)
  }

  async uninstallApp(app: AppInfo) {
    await execPromise(`scoop uninstall ${app.bucket}/${app.appName}`)
  }

  async resetApp(app: AppInfo) {
    await execPromise(`scoop reset ${app.bucket}/${app.appName}`)
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
}
