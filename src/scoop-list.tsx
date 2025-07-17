import type { AppInfo } from './core'
import { Action, ActionPanel, Color, Icon, List } from '@raycast/api'
import { useEffect, useState } from 'react'
import { Scoop } from './core'
import { withErrorHandling } from './logic'

export default function command() {
  const scoop = new Scoop()
  const [apps, setApps] = useState<AppInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    (async () => {
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

  const getShortDescription = (name: string, description: string) => {
    const availableSpace = 70
    const maxDescriptionLength = availableSpace - name.length - 3 // 3 for "..."

    if (name.length + description.length <= availableSpace) {
      return description
    }

    if (maxDescriptionLength <= 0) {
      return '...'
    }

    let truncatedDescription = description.slice(0, maxDescriptionLength)

    if (description.length > maxDescriptionLength && description[maxDescriptionLength] !== ' ') {
      const lastSpaceIndex = truncatedDescription.lastIndexOf(' ')
      if (lastSpaceIndex > 0) {
        truncatedDescription = truncatedDescription.slice(0, lastSpaceIndex)
      }
    }

    return `${truncatedDescription.trim()}...`
  }

  function getColorFromBucket(bucket: string): string {
  // 简单哈希算法
    let hash = 0
    for (let i = 0; i < bucket.length; i++) {
      hash = bucket.charCodeAt(i) + ((hash << 5) - hash)
    }
    // 取色相，范围0-359
    const hue = Math.abs(hash) % 360
    return `hsl(${hue}, 70%, 50%)`
  }

  function handleStartApp(app: AppInfo) {
    return withErrorHandling(
      async () => {
        await scoop.startApp(app)
      },
      errorMessage => ({
        title: 'Error starting app',
        message: errorMessage,
      }),
    )
  }

  function handleOpenInExplorer(app: AppInfo) {
    return withErrorHandling(
      async () => {
        await scoop.openAppInExplorer(app)
      },
      errorMessage => ({
        title: 'Error opening app in Explorer',
        message: errorMessage,
      }),
    )
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search Scoop apps...">
      {apps.map(app => (
        <List.Item
          key={app.name}
          icon={{ fileIcon: app.exePath }}
          title={app.name}
          subtitle={getShortDescription(app.name, app.description)}
          keywords={[app.name, app.description || '']}
          accessories={[
            {
              tag: {
                value: `v${app.version}`,
                color: Color.Blue,
              },
            },
            {
              tag: {
                value: app.bucket,
                color: getColorFromBucket(app.bucket),
              },
            },
          ]}
          actions={(
            <ActionPanel>
              <Action
                title="Start App"
                icon={Icon.Play}
                onAction={() => { handleStartApp(app) }}
              />
              <Action
                title="Open in Explorer"
                icon={Icon.Finder}
                onAction={() => { handleOpenInExplorer(app) }}
              />
              <Action
                title="Open Homepage"
                icon={Icon.Globe}
                onAction={() => {
                }}
              />
              <Action
                title="Update"
                icon={Icon.ArrowClockwise}
                onAction={() => {
                }}
              />
              <Action
                title="Uninstall"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => {
                }}
              />
              <Action
                title="Reset"
                icon={Icon.RotateAntiClockwise}
                style={Action.Style.Destructive}
                onAction={() => {
                }}
              />
            </ActionPanel>
          )}
        />
      ))}
    </List>
  )
}
