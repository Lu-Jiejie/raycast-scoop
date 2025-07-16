/**
 * https://github.com/joaolucaswork/raycast-windows-extension-template/blob/main/examples/basic/simple-list-command.tsx
 * 简单列表命令示例
 *
 * 本示例演示了一个基础的 Raycast 列表命令，功能包括：
 * - 显示一组列表项
 * - 支持搜索功能
 * - 每个列表项包含操作
 * - 显示加载状态
 * - 优雅地处理错误
 */
import {
  Action,
  ActionPanel,
  getPreferenceValues,
  Icon,
  List,
  showToast,
  Toast,
} from '@raycast/api'
import { useEffect, useState } from 'react'

// Define the data structure
// 定义数据结构
interface ListItem {
  id: string
  title: string
  subtitle?: string
  description?: string
  url?: string
  icon?: string
}

// Define preferences interface
// 定义偏好设置接口
interface Preferences {
  maxResults: string
  showSubtitles: boolean
}

// Mock data - replace with your actual data source
// 模拟数据 - 请替换为你的实际数据源
const mockData: ListItem[] = [
  {
    id: '1',
    title: 'First Item',
    subtitle: 'This is the first item',
    description: 'Detailed description of the first item',
    url: 'https://example.com/1',
    icon: '📄',
  },
  {
    id: '2',
    title: 'Second Item',
    subtitle: 'This is the second item',
    description: 'Detailed description of the second item',
    url: 'https://example.com/2',
    icon: '📋',
  },
  {
    id: '3',
    title: 'Third Item',
    subtitle: 'This is the third item',
    description: 'Detailed description of the third item',
    url: 'https://example.com/3',
    icon: '📊',
  },
]

// Simulate async data loading
// 模拟异步数据加载
async function loadData(): Promise<ListItem[]> {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 1000))

  // 模拟可能的错误（取消注释可测试错误处理）
  // if (Math.random() > 0.8) {
  //   throw new Error("无法从服务器加载数据");
  // }

  return mockData
}

export default function Command() {
  const [items, setItems] = useState<ListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchText, setSearchText] = useState('')

  const preferences = getPreferenceValues<Preferences>()
  const maxResults = Number.parseInt(preferences.maxResults) || 10

  // Load data on component mount
  // 组件挂载时加载数据
  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true)
        const data = await loadData()
        setItems(data)
      }
      catch (error) {
        console.error('数据加载失败:', error)
        await showToast({
          style: Toast.Style.Failure,
          title: '数据加载失败',
          message: error instanceof Error ? error.message : '发生未知错误',
        })
        setItems([]) // 出错时设置为空数组
      }
      finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Filter items based on search text
  // 根据搜索文本过滤列表项
  const filteredItems = items.filter((item) => {
    if (!searchText)
      return true

    const searchLower = searchText.toLowerCase()
    return (
      item.title.toLowerCase().includes(searchLower)
      || item.subtitle?.toLowerCase().includes(searchLower)
      || item.description?.toLowerCase().includes(searchLower)
    )
  }).slice(0, maxResults)

  // Handle item actions
  // 处理列表项的操作
  async function handleCopyTitle(item: ListItem) {
    await showToast({
      style: Toast.Style.Success,
      title: '已复制到剪贴板',
      message: item.title,
    })
  }

  async function handleViewDetails(item: ListItem) {
    await showToast({
      style: Toast.Style.Success,
      title: '查看详情',
      message: `已选择：${item.title}`,
    })
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search items..."
      throttle={true}
    >
      {filteredItems.length === 0 && !isLoading
        ? (
            <List.EmptyView
              icon={Icon.MagnifyingGlass}
              title="No items found"
              description={searchText ? `No items match "${searchText}"` : 'No items available'}
            />
          )
        : (
            filteredItems.map(item => (
              <List.Item
                key={item.id}
                icon={item.icon || Icon.Document}
                title={item.title}
                subtitle={preferences.showSubtitles ? item.subtitle : undefined}
                accessories={[
                  { text: `ID: ${item.id}` },
                ]}
                actions={(
                  <ActionPanel>
                    <ActionPanel.Section title="Primary Actions">
                      <Action
                        title="View Details"
                        icon={Icon.Eye}
                        onAction={() => handleViewDetails(item)}
                      />
                      {item.url && (
                        <Action.OpenInBrowser
                          title="Open in Browser"
                          url={item.url}
                        />
                      )}
                    </ActionPanel.Section>

                    <ActionPanel.Section title="Copy Actions">
                      <Action.CopyToClipboard
                        title="Copy Title"
                        content={item.title}
                        onCopy={() => handleCopyTitle(item)}
                      />
                      {item.url && (
                        <Action.CopyToClipboard
                          title="Copy URL"
                          content={item.url}
                        />
                      )}
                      {item.description && (
                        <Action.CopyToClipboard
                          title="Copy Description"
                          content={item.description}
                        />
                      )}
                    </ActionPanel.Section>
                  </ActionPanel>
                )}
              />
            ))
          )}
    </List>
  )
}

/**
 * Usage Notes:
 *
 * 1. Replace mockData and loadData() with your actual data source
 * 2. Customize the ListItem interface to match your data structure
 * 3. Add more actions as needed for your use case
 * 4. Configure preferences in package.json:
 *
 * "preferences": [
 *   {
 *     "name": "maxResults",
 *     "title": "Maximum Results",
 *     "description": "Maximum number of items to display",
 *     "type": "textfield",
 *     "default": "10",
 *     "required": false
 *   },
 *   {
 *     "name": "showSubtitles",
 *     "title": "Show Subtitles",
 *     "description": "Display subtitles for list items",
 *     "type": "checkbox",
 *     "default": true,
 *     "required": false,
 *     "label": "Show subtitles in list"
 *   }
 * ]
 */
/**
 * 使用说明：
 *
 * 1. 请将 mockData 和 loadData() 替换为你的实际数据源
 * 2. 根据你的数据结构自定义 ListItem 接口
 * 3. 根据实际需求添加更多操作
 * 4. 在 package.json 中配置偏好设置：
 *
 * "preferences": [
 *   {
 *     "name": "maxResults",
 *     "title": "最大结果数",
 *     "description": "要显示的最大条目数",
 *     "type": "textfield",
 *     "default": "10",
 *     "required": false
 *   },
 *   {
 *     "name": "showSubtitles",
 *     "title": "显示副标题",
 *     "description": "为列表项显示副标题",
 *     "type": "checkbox",
 *     "default": true,
 *     "required": false,
 *     "label": "在列表中显示副标题"
 *   }
 * ]
 */
