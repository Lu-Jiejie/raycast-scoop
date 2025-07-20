import type { AppInfo } from './core'
import { join } from 'node:path/posix'
import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List } from '@raycast/api'
import { useCachedState } from '@raycast/utils'
import { useEffect, useMemo, useState } from 'react'
import { Scoop } from './core'
import { showErrorToast, showLoadingToast, showSuccessToast, ToastMessages, withErrorHandling } from './logic/toast'

/**
 * App version cache management interfaces
 */
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

const CACHE_TTL = 5 * 60 * 1000 // Cache time-to-live: 5 minutes
const APP_VERSION_INFO_CACHE_KEY = 'scoop-app-version-info'
const APP_LIST_CACHE_KEY = 'scoop-app-list'

export default function command() {
  const scoop = new Scoop()
  const [isLoading, setIsLoading] = useState(true)
  const [appVersionInfo, setAppVersionInfo] = useCachedState<AppVersionInfo>(APP_VERSION_INFO_CACHE_KEY, {})
  const [apps, setApps] = useCachedState<AppInfo[]>(APP_LIST_CACHE_KEY, [])
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)

  /**
   * Get unique buckets from apps list (memoized)
   */
  const buckets = useMemo(() => {
    const bucketsSet = new Set<string>()
    apps.forEach((app) => {
      if (app.bucket)
        bucketsSet.add(app.bucket)
    })
    return Array.from(bucketsSet).sort()
  }, [apps])

  /**
   * Filter apps by selected bucket (memoized)
   */
  const filteredApps = useMemo(() => {
    return selectedBucket
      ? apps.filter(app => app.bucket === selectedBucket)
      : apps
  }, [apps, selectedBucket])

  /**
   * Get version status for an app (helper function)
   */
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

  /**
   * Determines if the app version cache has expired
   */
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
      if (apps.length > 0 && !isCacheExpired()) {
        setIsLoading(false)
        return
      }

      const result = await withErrorHandling(
        async () => {
          return await scoop.getScoopList()
        },
        errorMessage => ToastMessages.APP_LIST.LOADING_FAILED(errorMessage),
      )

      if (result) {
        setApps(result)
      }
      setIsLoading(false)
    })()
  }, [])

  /**
   * Generate shortened description for apps in the list view
   * Memoized to improve rendering performance
   */
  const getShortDescription = useMemo(() => {
    const cache = new Map<string, string>()

    return (app: AppInfo) => {
      // Use cached value if available
      if (cache.has(app.appName)) {
        return cache.get(app.appName) as string
      }

      const availableSpace = 70
      const versionStatus = getAppVersionStatus(app)
      const versionTagLength = versionStatus.versionTag.length
      const bucketTagLength = app.bucket ? app.bucket.length : 0
      const maxDescriptionLength = availableSpace - app.appName.length - versionTagLength - bucketTagLength - 6

      let result: string

      if (maxDescriptionLength <= 0) {
        result = '...'
      }
      else if (app.description.length <= maxDescriptionLength) {
        result = app.description
      }
      else {
        let truncatedDescription = app.description.slice(0, maxDescriptionLength)

        if (app.description.length > maxDescriptionLength && app.description[maxDescriptionLength] !== ' ') {
          const lastSpaceIndex = truncatedDescription.lastIndexOf(' ')
          if (lastSpaceIndex > 0) {
            truncatedDescription = truncatedDescription.slice(0, lastSpaceIndex)
          }
        }

        result = `${truncatedDescription.trim()}...`
      }

      // Cache the result
      cache.set(app.appName, result)
      return result
    }
  }, [apps, appVersionInfo])

  async function handleCheckNewVersion(app: AppInfo) {
    const { title, message } = ToastMessages.VERSION_CHECK.LOADING(app.appName)
    const loadingToast = await showLoadingToast(title, message)
    const newVersion = await scoop.checkNewVersion(app)
    loadingToast.hide()

    if (newVersion !== '' && newVersion !== app.version) {
      const { title, message } = ToastMessages.VERSION_CHECK.NEW_AVAILABLE(app.appName, newVersion)
      showSuccessToast(title, message)
    }
    else if (newVersion === '') {
      const { title, message } = ToastMessages.VERSION_CHECK.FAILED(app.appName)
      showErrorToast(title, message)
    }
    else {
      const { title, message } = ToastMessages.VERSION_CHECK.UP_TO_DATE(app.appName)
      showSuccessToast(title, message)
    }
    return newVersion
  }

  /**
   * Check all installed apps for available updates
   */
  async function handleCheckAllNewVersions() {
    // Use current filtered view or all apps depending on context
    const appsToCheck = filteredApps
    const scope = selectedBucket ? `in "${selectedBucket}" bucket` : ''

    const loadingToast = await showLoadingToast(
      'Checking for Updates',
      `Checking apps ${scope} for new versions...`,
    )

    const results = await Promise.all(
      appsToCheck.map(async (app: AppInfo) => {
        const newVersion = await scoop.checkNewVersion(app)
        return { appName: app.appName, newVersion, lastChecked: Date.now() }
      }),
    )

    loadingToast.hide()

    const newCache = { ...appVersionInfo }
    results.forEach(({ appName, newVersion, lastChecked }: {
      appName: string
      newVersion: string
      lastChecked: number
    }) => {
      newCache[appName] = { newVersion, lastChecked }
    })
    setAppVersionInfo(newCache)

    const updatesAvailable = appsToCheck.filter((app: AppInfo) => getAppVersionStatus(app).hasUpdate)

    const { title, message } = ToastMessages.VERSION_CHECK.COMPLETED(updatesAvailable.length)
    showSuccessToast(title, message)
  }

  async function handleUpdateNewVersion(app: AppInfo) {
    const versionStatus = getAppVersionStatus(app)

    if (!versionStatus.hasUpdate) {
      const { title, message } = ToastMessages.VERSION_CHECK.UP_TO_DATE(app.appName)
      showSuccessToast(title, message)
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

    const { title, message } = ToastMessages.APP_UPDATE.LOADING(app.appName, versionStatus.newVersion)
    const loadingToast = await showLoadingToast(title, message)

    const result = await withErrorHandling(
      async () => {
        await scoop.updateNewVersion(app)

        loadingToast.hide()
        return await scoop.getAppInfo(app.appName)
      },
      errorMessage => ToastMessages.APP_UPDATE.FAILED(app.appName, errorMessage),
      ToastMessages.APP_UPDATE.SUCCESS(app.appName),
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

      const { title, message } = ToastMessages.APP_UPDATE.SUCCESS(app.appName, result.version)
      showSuccessToast(title, message)
    }
  }

  async function handleUpdateAllApps() {
    const currentApps = filteredApps
    const appsToUpdate = currentApps.filter((app: AppInfo) => getAppVersionStatus(app).hasUpdate)
    const scope = selectedBucket ? `in "${selectedBucket}" bucket` : ''

    if (appsToUpdate.length === 0) {
      const { title, message } = ToastMessages.VERSION_CHECK.UP_TO_DATE(selectedBucket || 'all apps')
      showSuccessToast(title, message)
      return
    }

    const confirmed = await confirmAlert({
      title: 'Update Apps',
      message: `Are you sure you want to update ${appsToUpdate.length} apps ${scope}?`.trim(),
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

    const loadingToast = await showLoadingToast('Updating Apps', `Updating ${appsToUpdate.length} apps ${scope}...`.trim())

    const updateResults = await Promise.allSettled(
      appsToUpdate.map(async (app: AppInfo) => {
        try {
          await scoop.updateNewVersion(app)
          const updatedApp = await scoop.getAppInfo(app.appName)
          return {
            success: true,
            app,
            updatedApp,
          }
        }
        catch (error) {
          return {
            success: false,
            app,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )

    updateResults.forEach((result: PromiseSettledResult<any>) => {
      if (result.status === 'fulfilled') {
        const { success, app, updatedApp, error } = result.value

        if (success && updatedApp) {
          // Update app in state
          setApps(currentCachedApps =>
            currentCachedApps.map(a => a.appName === updatedApp.appName ? updatedApp : a),
          )

          // Remove from version cache
          setAppVersionInfo((prev) => {
            const newCache = { ...prev }
            delete newCache[app.appName]
            return newCache
          })

          const { title, message } = ToastMessages.APP_UPDATE.SUCCESS(app.appName, updatedApp.version)
          showSuccessToast(title, message)
        }
        else if (!success) {
          const { title, message } = ToastMessages.APP_UPDATE.FAILED(app.appName, error)
          showErrorToast(title, message)
        }
      }
      else if (result.status === 'rejected') {
        console.error('Unexpected promise rejection:', result.reason)
      }
    })

    loadingToast.hide()
    const { title, message } = ToastMessages.BULK_UPDATE.COMPLETED(appsToUpdate.length)
    showSuccessToast(title, message)
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

    const { title, message } = ToastMessages.APP_LIST.REFRESH_LOADING()
    const loadingToast = await showLoadingToast(title, message)

    // Clear version cache
    setAppVersionInfo({})

    const result = await withErrorHandling(
      async () => {
        return await scoop.getScoopList()
      },
      errorMessage => ToastMessages.APP_LIST.LOADING_FAILED(errorMessage),
      ToastMessages.APP_LIST.REFRESH_COMPLETED(),
    )

    if (result) {
      setApps(result)
    }

    loadingToast.hide()
    setIsLoading(false)
  }

  async function handleUninstallApp(app: AppInfo) {
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

    const { title, message } = ToastMessages.APP_UNINSTALL.LOADING(app.appName)
    const loadingToast = await showLoadingToast(title, message)

    const result = await withErrorHandling(
      async () => {
        await scoop.uninstallApp(app)
        loadingToast.hide()
        return true
      },
      errorMessage => ToastMessages.APP_UNINSTALL.FAILED(app.appName, errorMessage),
      ToastMessages.APP_UNINSTALL.SUCCESS(app.appName),
    )

    if (result) {
      setApps(currentApps => currentApps.filter(a => a.appName !== app.appName))

      setAppVersionInfo((prev) => {
        const newCache = { ...prev }
        delete newCache[app.appName]
        return newCache
      })
    }
  }

  async function handleResetApp(app: AppInfo) {
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

    const { title, message } = ToastMessages.APP_RESET.LOADING(app.appName)
    const loadingToast = await showLoadingToast(title, message)

    await withErrorHandling(
      async () => {
        await scoop.resetApp(app)
        loadingToast.hide()
        return true
      },
      errorMessage => ToastMessages.APP_RESET.FAILED(app.appName, errorMessage),
      ToastMessages.APP_RESET.SUCCESS(app.appName),
    )
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Scoop apps..."
      searchBarAccessory={(
        <List.Dropdown
          tooltip="Filter by Bucket"
          storeValue={true}
          onChange={newValue => setSelectedBucket(newValue === 'all' ? null : newValue)}
        >
          <List.Dropdown.Item title="All Buckets" value="all" />
          {buckets.map((bucket: string) => (
            <List.Dropdown.Item key={bucket} title={bucket} value={bucket} />
          ))}
        </List.Dropdown>
      )}
    >
      {filteredApps.map((app: AppInfo) => (
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
