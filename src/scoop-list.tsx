import type { AppInfo } from './core'
import { join } from 'node:path/posix'
import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List } from '@raycast/api'
import { useCachedState } from '@raycast/utils'
import { useEffect, useState } from 'react'
import { Scoop } from './core'
import { showErrorToast, showLoadingToast, showSuccessToast, withErrorHandling } from './logic'

// Cache related types and constants
interface AppVersionInfo {
  [appName: string]: {
    newVersion: string
    lastChecked: number
  }
}

interface AppVersionStatus {
  hasUpdate: boolean
  currentVersion: string
  newVersion: string
  versionTag: string
  versionTagColor: Color
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes cache TTL
const APP_VERSION_INFO_CACHE_KEY = 'scoop-app-version-info'
const APP_LIST_CACHE_KEY = 'scoop-app-list'

export default function command() {
  const scoop = new Scoop()
  const [isLoading, setIsLoading] = useState(true)
  const [appVersionInfo, setAppVersionInfo] = useCachedState<AppVersionInfo>(APP_VERSION_INFO_CACHE_KEY, {})
  const [apps, setApps] = useCachedState<AppInfo[]>(APP_LIST_CACHE_KEY, [])

  const getAppVersionStatus = (app: AppInfo): AppVersionStatus => {
    const cachedVersionInfo = appVersionInfo[app.appName]
    const hasUpdate = !!(cachedVersionInfo?.newVersion
      && cachedVersionInfo.newVersion !== app.version
      && cachedVersionInfo.newVersion !== '')

    return {
      hasUpdate,
      currentVersion: app.version,
      newVersion: hasUpdate ? cachedVersionInfo.newVersion : '',
      versionTag: hasUpdate
        ? `v${app.version} -> v${cachedVersionInfo.newVersion}`
        : `v${app.version}`,
      versionTagColor: hasUpdate ? Color.Yellow : Color.Blue,
    }
  }

  // Check if cache is expired
  const isCacheExpired = () => {
    if (apps.length === 0)
      return true

    const now = Date.now()
    const lastAppWithTime = Object.values(appVersionInfo)[0]
    if (!lastAppWithTime)
      return true

    return (now - lastAppWithTime.lastChecked) > CACHE_TTL
  }

  useEffect(() => {
    (async () => {
      // Use cache if available and not expired
      if (apps.length > 0 && !isCacheExpired()) {
        setIsLoading(false)
        return
      }

      // Refresh data if no cache or cache expired
      const result = await withErrorHandling(
        async () => {
          return await scoop.getScoopList()
        },
        errorMessage => ({
          title: 'Error loading Scoop apps',
          message: errorMessage,
        }),
      )

      if (result) {
        setApps(result)
      }
      setIsLoading(false)
    })()
  }, [])

  const getShortDescription = (app: AppInfo) => {
    const availableSpace = 70

    const versionStatus = getAppVersionStatus(app)
    const versionTagLength = versionStatus.versionTag.length
    const bucketTagLength = app.bucket ? app.bucket.length : 0

    const maxDescriptionLength = availableSpace - app.appName.length - versionTagLength - bucketTagLength - 6

    if (maxDescriptionLength <= 0) {
      return '...'
    }

    if (app.description.length <= maxDescriptionLength) {
      return app.description
    }

    let truncatedDescription = app.description.slice(0, maxDescriptionLength)

    if (app.description.length > maxDescriptionLength && app.description[maxDescriptionLength] !== ' ') {
      const lastSpaceIndex = truncatedDescription.lastIndexOf(' ')
      if (lastSpaceIndex > 0) {
        truncatedDescription = truncatedDescription.slice(0, lastSpaceIndex)
      }
    }

    return `${truncatedDescription.trim()}...`
  }

  async function handleCheckNewVersion(app: AppInfo) {
    const loadingToast = await showLoadingToast('Checking for Updates', `Checking ${app.appName} for new version...`)
    const newVersion = await scoop.checkNewVersion(app)
    loadingToast.hide()

    if (newVersion !== '' && newVersion !== app.version) {
      showSuccessToast(app.appName, `New version available: ${newVersion}`)
    }
    else if (newVersion === '') {
      showErrorToast(app.appName, 'Failed to check for new version')
    }
    else {
      showSuccessToast(app.appName, 'Already on the latest version')
    }
    return newVersion
  }

  // Check all apps for new versions
  async function handleCheckAllNewVersions() {
    const loadingToast = await showLoadingToast('Checking for Updates', 'Checking all apps for new versions...')

    const results = await Promise.all(
      apps.map(async (app) => {
        const newVersion = await scoop.checkNewVersion(app)
        return { appName: app.appName, newVersion, lastChecked: Date.now() }
      }),
    )

    loadingToast.hide()

    const newCache = { ...appVersionInfo }
    results.forEach(({ appName, newVersion, lastChecked }) => {
      newCache[appName] = { newVersion, lastChecked }
    })
    setAppVersionInfo(newCache)

    const updatesAvailable = apps.filter(app => getAppVersionStatus(app).hasUpdate)

    if (updatesAvailable.length > 0) {
      showSuccessToast(
        'Check Completed',
        `Found ${updatesAvailable.length} apps with updates available`,
      )
    }
    else {
      showSuccessToast('Check Completed', 'All apps are up-to-date')
    }
  }

  async function handleUpdateNewVersion(app: AppInfo) {
    const versionStatus = getAppVersionStatus(app)

    if (!versionStatus.hasUpdate) {
      showSuccessToast('No Update Available', 'App is already on the latest version')
      return
    }
    const confirmed = await confirmAlert({
      title: 'Update App',
      message: `Are you sure you want to update ${app.appName} to version ${versionStatus.newVersion}?`,
      primaryAction: {
        title: 'Update',
        style: Alert.ActionStyle.Destructive,
      },
      dismissAction: {
        title: 'Cancel',
      },
      icon: Icon.Download,
    })

    if (!confirmed)
      return

    const loadingToast = await showLoadingToast('Updating App', `Updating ${app.appName} to version ${versionStatus.newVersion}...`)

    const result = await withErrorHandling(
      async () => {
        await scoop.updateNewVersion(app)

        loadingToast.hide()
        return await scoop.getAppInfo(app.appName)
      },
      errorMessage => ({
        title: 'Error updating app',
        message: errorMessage,
      }),
      {
        title: 'App Updated',
        message: `Successfully updated ${app.appName} to the latest version.`,
      },
    )

    if (result) {
      const updatedApps = apps.map(a =>
        a.appName === app.appName ? result : a,
      )
      setApps(updatedApps)
      setAppVersionInfo((prev) => {
        const newCache = { ...prev }
        delete newCache[app.appName]
        return newCache
      })

      showSuccessToast('Update Complete', `Successfully updated ${app.appName} to version ${result.version}`)
    }
  }

  async function handleUpdateAllApps() {
    const appsToUpdate = apps.filter(app => getAppVersionStatus(app).hasUpdate)

    if (appsToUpdate.length === 0) {
      showSuccessToast('No Updates', 'All apps are already up-to-date')
      return
    }

    const confirmed = await confirmAlert({
      title: 'Update All Apps',
      message: `Are you sure you want to update ${appsToUpdate.length} apps?`,
      primaryAction: {
        title: 'Update',
        style: Alert.ActionStyle.Destructive,
      },
      dismissAction: {
        title: 'Cancel',
      },
      icon: Icon.Download,
    })
    if (!confirmed)
      return

    const loadingToast = await showLoadingToast('Updating Apps', `Updating ${appsToUpdate.length} apps...`)

    for (const app of appsToUpdate) {
      try {
        await scoop.updateNewVersion(app)
        const updatedApp = await scoop.getAppInfo(app.appName)

        if (updatedApp) {
          setApps(currentCachedApps =>
            currentCachedApps.map(a => a.appName === updatedApp.appName ? updatedApp : a),
          )
          setAppVersionInfo((prev) => {
            const newCache = { ...prev }
            delete newCache[app.appName]
            return newCache
          })

          showSuccessToast('App Updated', `Successfully updated ${app.appName} to version ${updatedApp.version}`)
        }
      }
      catch (error) {
        showSuccessToast('Update Failed', `Failed to update ${app.appName}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    loadingToast.hide()
    showSuccessToast('Updates Complete', `Finished updating apps`)
  }

  async function handleRefreshAppList() {
    const confirmed = await confirmAlert({
      title: 'Refresh App List',
      message: 'Are you sure you want to refresh the app list?',
      primaryAction: {
        title: 'Refresh',
        style: Alert.ActionStyle.Destructive,
      },
      dismissAction: {
        title: 'Cancel',
      },
      icon: Icon.RotateAntiClockwise,
    })

    if (!confirmed)
      return

    setIsLoading(true)

    const loadingToast = await showLoadingToast('Reloading App List', 'Refreshing Scoop app list...')

    // 清除所有缓存
    setAppVersionInfo({})

    const result = await withErrorHandling(
      async () => {
        return await scoop.getScoopList()
      },
      errorMessage => ({
        title: 'Error loading Scoop apps',
        message: errorMessage,
      }),
      {
        title: 'App List Reloaded',
        message: 'Successfully refreshed the app list',
      },
    )

    if (result) {
      setApps(result)
    }

    loadingToast.hide()
    setIsLoading(false)
  }

  async function handleUninstallApp(app: AppInfo) {
    // Confirmation dialog
    const confirmed = await confirmAlert({
      title: 'Uninstall App',
      message: `Are you sure you want to uninstall ${app.appName}?`,
      primaryAction: {
        title: 'Uninstall',
        style: Alert.ActionStyle.Destructive,
      },
      dismissAction: {
        title: 'Cancel',
      },
      icon: Icon.Trash,
    })

    if (!confirmed)
      return

    const loadingToast = await showLoadingToast('Uninstalling', `Uninstalling ${app.appName}...`)

    const result = await withErrorHandling(
      async () => {
        await scoop.uninstallApp(app)
        loadingToast.hide()
        return true
      },
      errorMessage => ({
        title: 'Error Uninstalling App',
        message: errorMessage,
      }),
      {
        title: 'App Uninstalled',
        message: `Successfully uninstalled ${app.appName}`,
      },
    )

    if (result) {
      // Remove the app from the apps list
      setApps(currentApps => currentApps.filter(a => a.appName !== app.appName))

      // Remove from version cache
      setAppVersionInfo((prev) => {
        const newCache = { ...prev }
        delete newCache[app.appName]
        return newCache
      })
    }
  }

  async function handleResetApp(app: AppInfo) {
    // Confirmation dialog
    const confirmed = await confirmAlert({
      title: 'Reset App',
      message: `Are you sure you want to reset ${app.appName}? This will re-register shortcuts and environment variables.`,
      primaryAction: {
        title: 'Reset',
        style: Alert.ActionStyle.Destructive,
      },
      dismissAction: {
        title: 'Cancel',
      },
      icon: Icon.RotateAntiClockwise,
    })

    if (!confirmed)
      return

    const loadingToast = await showLoadingToast('Resetting App', `Resetting ${app.appName}...`)

    await withErrorHandling(
      async () => {
        await scoop.resetApp(app)
        loadingToast.hide()
        return true
      },
      errorMessage => ({
        title: 'Error Resetting App',
        message: errorMessage,
      }),
      {
        title: 'App Reset',
        message: `Successfully reset ${app.appName}`,
      },
    )
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Scoop apps..."
    >
      {apps.map(app => (
        <List.Item
          key={app.appName}
          icon={{ fileIcon: join(app.dirPath, app.exeName) }}
          title={app.appName}
          subtitle={getShortDescription(app)}
          keywords={[app.appName, app.description || '']}
          accessories={[

            {
              tag: {
                value: getAppVersionStatus(app).versionTag,
                color: getAppVersionStatus(app).versionTagColor,
              },
            },
            {
              tag: app.bucket,
            },
          ]}
          actions={(
            <ActionPanel>
              <ActionPanel.Section title="App Actions">
                <Action.Open
                  title="Open App"
                  icon={Icon.Play}
                  target={join(app.dirPath, app.exeName)}
                />
                <Action.ShowInFinder
                  title="Open in Explorer"
                  icon={Icon.Folder}
                  path={join(app.dirPath, app.exeName)}
                />
                <Action.OpenInBrowser
                  title="Open Homepage"
                  icon={Icon.Globe}
                  url={app.homepage}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Management Actions">
                <Action
                  title="Check New Version"
                  icon={Icon.ArrowClockwise}
                  onAction={() => handleCheckNewVersion(app)}
                />
                <Action
                  title="Update"
                  icon={Icon.Download}
                  onAction={() => handleUpdateNewVersion(app)}
                />
                <Action
                  title="Uninstall"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => handleUninstallApp(app)}
                />
                <Action
                  title="Reset"
                  icon={Icon.RotateAntiClockwise}
                  style={Action.Style.Destructive}
                  onAction={() => handleResetApp(app)}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Bulk Actions">
                <Action
                  title="Check All Apps for Updates"
                  icon={Icon.ArrowClockwise}
                  onAction={handleCheckAllNewVersions}
                />
                <Action
                  title="Update All Apps"
                  icon={Icon.Download}
                  onAction={handleUpdateAllApps}
                />
                <Action
                  title="Refresh App List"
                  icon={Icon.RotateAntiClockwise}
                  onAction={handleRefreshAppList}
                />
              </ActionPanel.Section>
            </ActionPanel>
          )}
        />
      ))}
    </List>
  )
}
