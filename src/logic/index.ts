import { exec } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { showToast, Toast } from '@raycast/api'

export const execPromise = promisify(exec)

export function showSuccessToast(title: string, message: string) {
  return showToast({
    style: Toast.Style.Success,
    title,
    message,
  })
}

export function showErrorToast(title: string, message: string) {
  return showToast({
    style: Toast.Style.Failure,
    title,
    message,
  })
}

export function showLoadingToast(title: string, message: string) {
  return showToast({
    style: Toast.Style.Animated,
    title,
    message,
  })
}

export async function withErrorHandling<T>(
  operation: () => Promise<T> | T,
  errorToast: (errorMessage: string) => {
    title: string
    message: string
  },
  successToast?: {
    title: string
    message: string
  },
): Promise<T | null> {
  try {
    const result = await operation()
    // Only show success toast when operation succeeds
    if (successToast) {
      await showSuccessToast(successToast.title, successToast.message)
    }
    return result
  }
  catch (error) {
    const { title, message } = errorToast(error instanceof Error ? error.message : 'Unknown error occurred')
    await showErrorToast(
      title,
      message,
    )
    return null
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isFile()
  }
  catch {
    return false
  }
}

export function toWindowsPath(path: string): string {
  return path.replaceAll('/', '\\')
}

export function toUnixPath(path: string): string {
  return path.replaceAll('\\', '/')
}

export function getFirstFlatItem<T>(item: T | T[] | T[][]): T | undefined {
  if (!Array.isArray(item)) {
    return item
  }

  const flattened = (item as any[]).flat(Infinity)
  return flattened.length > 0 ? flattened[0] : undefined
}

export async function getAllDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const paths = entries.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name)
    return paths
  }
  catch (error) {
    throw new Error((error as Error).message)
  }
}
