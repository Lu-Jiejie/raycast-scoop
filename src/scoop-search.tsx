import type { AppInfo, AvailableAppInfo } from './core'
import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List } from '@raycast/api'
import { useCachedState } from '@raycast/utils'
import { useEffect, useMemo, useState } from 'react'
import { Scoop } from './core'
import { showLoadingToast, showSuccessToast, ToastMessages, withErrorHandling } from './logic/toast'

interface AvailableAppsCache {
  [bucket: string]: {
    apps: AvailableAppInfo[]
    lastUpdated: number
  }
}

const CACHE_TTL = 30 * 60 * 1000
const AVAILABLE_APPS_CACHE_KEY = 'scoop-available-apps'
const APP_LIST_CACHE_KEY = 'scoop-app-list'

export default function command() {
  const scoop = new Scoop()
  const [isLoading, setIsLoading] = useState(true)
  const [availableAppsCache, setAvailableAppsCache] = useCachedState<AvailableAppsCache>(AVAILABLE_APPS_CACHE_KEY, {})
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
  const [installedAppList, setInstalledAppList] = useCachedState<AppInfo[]>(APP_LIST_CACHE_KEY, [])
  const installedApps = useMemo(() => new Set(installedAppList.map(app => app.appName.toLowerCase())), [installedAppList])
  const [allAvailableApps, setAllAvailableApps] = useState<AvailableAppInfo[]>([])

  const buckets = useMemo(() => {
    const bucketsSet = new Set<string>()
    allAvailableApps.forEach((app) => {
      if (app.bucket)
        bucketsSet.add(app.bucket)
    })
    return Array.from(bucketsSet).sort()
  }, [allAvailableApps])

  const filteredApps = useMemo(() => {
    return selectedBucket
      ? allAvailableApps.filter(app => app.bucket === selectedBucket)
      : allAvailableApps
  }, [allAvailableApps, selectedBucket])

  const isCacheExpired = (bucket: string) => {
    const cachedData = availableAppsCache[bucket]
    if (!cachedData)
      return true
    const now = Date.now()
    return (now - cachedData.lastUpdated) > CACHE_TTL
  }

  async function loadAllAvailableApps() {
    setIsLoading(true)
    const { title, message } = ToastMessages.APP_SEARCH.LOADING()
    const loadingToast = await showLoadingToast(title, message)
    const result = await withErrorHandling(
      async () => {
        const buckets = await scoop.getAllBuckets()
        const allApps: AvailableAppInfo[] = []
        const newCache = { ...availableAppsCache }
        const bucketResults = await Promise.allSettled(buckets.map(async (bucket) => {
          let bucketApps: AvailableAppInfo[]
          if (!isCacheExpired(bucket)) {
            bucketApps = availableAppsCache[bucket]?.apps.map(app => ({
              ...app,
              installed: installedApps.has(app.appName.toLowerCase()),
            })) || []
          }
          else {
            bucketApps = await scoop.loadAppsFromBucket(bucket, installedApps)
            newCache[bucket] = {
              apps: bucketApps,
              lastUpdated: Date.now(),
            }
          }
          return { bucket, apps: bucketApps }
        }))
        bucketResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            allApps.push(...result.value.apps)
          }
        })
        setAvailableAppsCache(newCache)
        allApps.sort((a, b) => a.appName.localeCompare(b.appName))
        return allApps
      },
      errorMessage => ToastMessages.APP_SEARCH.FAILED(errorMessage),
      ToastMessages.APP_SEARCH.REFRESH_COMPLETED(0),
    )
    loadingToast.hide()
    if (result) {
      setAllAvailableApps(result)
      const { title, message } = ToastMessages.APP_SEARCH.REFRESH_COMPLETED(result.length)
      showSuccessToast(title, message)
    }
    setIsLoading(false)
  }

  async function handleInstallApp(app: AvailableAppInfo) {
    const confirmed = await confirmAlert({
      title: 'Install App',
      message: `Are you sure you want to install ${app.appName}?`,
      primaryAction: { title: 'Install', style: Alert.ActionStyle.Default },
      dismissAction: { title: 'Cancel' },
      icon: Icon.Download,
    })
    if (!confirmed)
      return
    const { title, message } = ToastMessages.APP_INSTALL.LOADING(app.appName)
    const loadingToast = await showLoadingToast(title, message)
    const result = await withErrorHandling(
      async () => {
        await scoop.installApp(app.bucket, app.appName)
        const newInstalledList = await scoop.getScoopList()
        setInstalledAppList(newInstalledList)
        return true
      },
      errorMessage => ToastMessages.APP_INSTALL.FAILED(app.appName, errorMessage),
      ToastMessages.APP_INSTALL.SUCCESS(app.appName),
    )
    loadingToast.hide()
    if (result) {
      setAllAvailableApps(apps =>
        apps.map(a => a.appName === app.appName ? { ...a, installed: true } : a),
      )
    }
  }

  async function handleUninstallApp(app: AvailableAppInfo) {
    const confirmed = await confirmAlert({
      title: 'Uninstall App',
      message: `Are you sure you want to uninstall ${app.appName}?`,
      primaryAction: { title: 'Uninstall', style: Alert.ActionStyle.Destructive },
      dismissAction: { title: 'Cancel' },
      icon: Icon.Trash,
    })
    if (!confirmed)
      return
    const { title, message } = ToastMessages.APP_UNINSTALL.LOADING(app.appName)
    const loadingToast = await showLoadingToast(title, message)
    const result = await withErrorHandling(
      async () => {
        await scoop.uninstallApp({ appName: app.appName, bucket: app.bucket })
        const newInstalledList = await scoop.getScoopList()
        setInstalledAppList(newInstalledList)
        return true
      },
      errorMessage => ToastMessages.APP_UNINSTALL.FAILED(app.appName, errorMessage),
      ToastMessages.APP_UNINSTALL.SUCCESS(app.appName),
    )
    loadingToast.hide()
    if (result) {
      setAllAvailableApps(apps =>
        apps.map(a => a.appName === app.appName ? { ...a, installed: false } : a),
      )
    }
  }

  async function handleRefreshAppsList() {
    const confirmed = await confirmAlert({
      title: 'Refresh Available Apps',
      message: 'Are you sure you want to refresh the list of available apps? This might take a while.',
      primaryAction: { title: 'Refresh', style: Alert.ActionStyle.Default },
      dismissAction: { title: 'Cancel' },
      icon: Icon.RotateClockwise,
    })
    if (!confirmed)
      return
    setIsLoading(true)
    const scope = selectedBucket || ''
    const { title, message } = ToastMessages.APP_SEARCH.REFRESH_LOADING(scope)
    const loadingToast = await showLoadingToast(title, message)
    if (selectedBucket) {
      setAvailableAppsCache((cache) => {
        const newCache = { ...cache }
        delete newCache[selectedBucket]
        return newCache
      })
    }
    else {
      setAvailableAppsCache({})
    }
    loadingToast.hide()
    await loadAllAvailableApps()
  }

  useEffect(() => {
    loadAllAvailableApps()
  }, [installedAppList])

  const getShortDescription = useMemo(() => {
    const cache = new Map<string, string>()
    return (app: AvailableAppInfo) => {
      const cacheKey = `${app.bucket}-${app.appName}`
      if (cache.has(cacheKey))
        return cache.get(cacheKey) as string
      if (!app.description) {
        cache.set(cacheKey, '')
        return ''
      }
      const availableSpace = 90
      const versionTagLength = app.version ? app.version.length : 0
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
        let truncated = app.description.slice(0, maxDescriptionLength)
        if (app.description.length > maxDescriptionLength && app.description[maxDescriptionLength] !== ' ') {
          const lastSpaceIndex = truncated.lastIndexOf(' ')
          if (lastSpaceIndex > 0)
            truncated = truncated.slice(0, lastSpaceIndex)
        }
        result = `${truncated.trim()}...`
      }
      cache.set(cacheKey, result)
      return result
    }
  }, [allAvailableApps, installedApps])

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search available Scoop apps..."
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
      actions={(
        <ActionPanel>
          <Action
            title="Refresh Available Apps"
            icon={Icon.RotateClockwise}
            onAction={handleRefreshAppsList}
          />
        </ActionPanel>
      )}
    >
      {filteredApps.map((app: AvailableAppInfo) => (
        <List.Item
          key={`${app.bucket}-${app.appName}`}
          title={app.appName}
          subtitle={getShortDescription(app)}
          keywords={[app.appName, app.description || '', app.bucket]}
          accessories={[
            app.installed
              ? {
                  icon: Icon.Download,
                }
              : {},
            {
              tag: {
                value: `v${app.version}`,
                color: Color.Blue,
              },
            },
            {
              tag: app.bucket,
            },
          ]}
          actions={(
            <ActionPanel>
              <ActionPanel.Section title="App Actions">
                <Action.OpenInBrowser
                  title="Open Homepage"
                  icon={Icon.Globe}
                  url={app.homepage}
                />
                {app.installed
                  ? (
                      <Action
                        title="Uninstall"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        onAction={() => handleUninstallApp(app)}
                      />
                    )
                  : (
                      <Action
                        title="Install"
                        icon={Icon.Download}
                        onAction={() => handleInstallApp(app)}
                      />
                    )}
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action
                  title="Refresh Available Apps"
                  icon={Icon.RotateClockwise}
                  onAction={handleRefreshAppsList}
                />
              </ActionPanel.Section>
            </ActionPanel>
          )}
        />
      ))}
    </List>
  )
}
