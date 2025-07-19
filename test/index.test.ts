import type { AppInfo } from '../src/core'
import semver from 'semver'
import { describe, expect, it } from 'vitest'
import { Scoop } from '../src/core'

describe('scoop check new version', async () => {
  it.skip('should work', async () => {
    async function checkNewVersion(app: AppInfo) {
      const checkver = app.checkver
      const homepage = app.homepage

      if (typeof checkver === 'string') {
        if (checkver === 'github' && homepage) {
          const repo = homepage.replace(/https?:\/\/(www\.)?github\.com\//, '')
          const apiUrl = `https://api.github.com/repos/${repo}/releases`
          const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
          })
          const releases = await response.json()
          const latest = (releases as Array<any>).find((release: any) => !release.prerelease)
          return latest?.tag_name ?? null
        }
      }
    }

    expect(await checkNewVersion({
      appName: 'Motrix',
      dirPath: '/path/to/motrix',
      version: '1.0.0',
      description: 'A full-featured download manager',
      exeName: 'motrix.exe',
      bucket: 'main',
      homepage: 'https://github.com/agalwood/Motrix',
      checkver: 'github',
    })).toMatchInlineSnapshot(`"v1.8.19"`)
  })

  it('should work with semver', () => {
    expect(semver.clean('V7.8.1', {
      loose: true,
    })).toMatchInlineSnapshot(`null`)
  })
})
