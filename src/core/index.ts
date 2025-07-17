import { access, constants, readdir, readFile, stat } from 'node:fs/promises'
import process from 'node:process'
import { getPreferenceValues } from '@raycast/api'
import { execPromise, isFile } from '../logic'

interface Checkver {
  url: string
  regex: string
}

export interface AppInfo {
  name: string
  dirPath: string
  version: string
  description: string
  exePath: string
  homepage: string
  checkver: Checkver
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

  private async getAllDirs(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const paths = entries.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name)
      return paths
    }
    catch (error) {
      throw new Error((error as Error).message)
    }
  }

  private getAppExeFromManifest(manifestContent: any): string {
    if (manifestContent.shortcuts) {
      const shortcuts = manifestContent.shortcuts
      if (typeof shortcuts === 'string')
        return shortcuts
      const firstShortcut = (shortcuts as Array<any>).flat(Infinity)[0]
      if (typeof firstShortcut === 'string') {
        return firstShortcut
      }
    }

    if (manifestContent.bin) {
      const bin = manifestContent.bin
      if (typeof bin === 'string')
        return bin
      const firstBin = (bin as Array<any>).flat(Infinity)[0]
      if (typeof firstBin === 'string') {
        return firstBin
      }
    }

    if (manifestContent.architecture) {
      const processArch = process.arch
      const arch = processArch === 'x64'
        ? '64bit'
        : processArch === 'ia32'
          ? '32bit'
          : processArch === 'arm64'
            ? 'arm64'
            : 'unknown'

      const shortcuts = manifestContent.architecture[arch].shortcuts
      if (shortcuts) {
        if (typeof shortcuts === 'string')
          return shortcuts
        const firstShortcut = (shortcuts as Array<any>).flat(Infinity)[0]
        if (typeof firstShortcut === 'string') {
          return firstShortcut
        }
      }

      const bin = manifestContent.architecture[arch].bin
      if (bin) {
        if (typeof bin === 'string')
          return bin
        const firstBin = (bin as Array<any>).flat(Infinity)[0]
        if (typeof firstBin === 'string') {
          return firstBin
        }
      }
    }

    return ''
  }

  async startApp(app: AppInfo) {
    const appExePath = app.exePath.replaceAll('/', '\\')
    try {
      if (await isFile(appExePath)) {
        await execPromise(`start "" "${appExePath}"`)
      }
      else {
        throw new Error(' ')
      }
    }
    catch {
      throw new Error(`Failed to start app: ${appExePath}`)
    }
  }

  async openAppInExplorer(app: AppInfo) {
    const appExePath = app.exePath.replaceAll('/', '\\')
    try {
      if (await isFile(appExePath)) {
        await execPromise(`explorer /select,"${appExePath}"`)
      }
      else {
        const appDirPath = app.dirPath.replaceAll('/', '\\')
        await execPromise(`start "" "${appDirPath}"`)
      }
    }
    catch {
      throw new Error(`Failed to open app in explorer: ${app.name}`)
    }
  }

  async getScoopList() {
    if (!await this.isValidScoopRoot()) {
      throw new Error('Scoop root is invalid or not set.')
    }

    // get all the dir in the scoopAppsPath
    const scoopAppsPath = `${this.scoopRoot}/apps`
    let appDirNameArr: string[] = []
    try {
      appDirNameArr = await this.getAllDirs(scoopAppsPath)
    }
    catch {
      throw new Error('Failed to read Scoop apps directory.')
    }

    if (appDirNameArr.length === 0) {
      throw new Error('No Scoop apps found.')
    }

    const appList: AppInfo[] = []
    for (const appDirName of appDirNameArr) {
      const appDirPath = `${scoopAppsPath}/${appDirName}/current`
      const manifestPath = `${appDirPath}/manifest.json`
      const installPath = `${appDirPath}/install.json`

      try {
        const manifestContent = JSON.parse(await readFile(manifestPath, 'utf-8'))
        const installContent = JSON.parse(await readFile(installPath, 'utf-8'))

        const version: string = manifestContent.version
        const description: string = Array.isArray(manifestContent.description)
          ? manifestContent.description[0]
          : manifestContent.description
        const homepage: string = manifestContent.homepage || ''
        const checkver: Checkver = manifestContent.checkver || { url: '', regex: '' }
        const bucket: string = installContent.bucket || 'unknown'

        const exeName = this.getAppExeFromManifest(manifestContent)
        const exePath = `${appDirPath}/${exeName}`
        const icon = exePath

        appList.push({
          name: appDirName,
          dirPath: appDirPath,
          version,
          description,
          exePath: icon,
          homepage,
          checkver,
          bucket,
        })
      }
      catch {
      }
    }

    return appList
  }
}
