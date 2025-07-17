import { exec } from 'node:child_process'
import { access, constants, stat } from 'node:fs/promises'
import { showToast, Toast } from '@raycast/api'

export function execPromise(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, async (error) => {
      // fix: explore /select often exits with code 1, but it still works
      if (command.startsWith('explorer /select') && error?.code === 1) {
        resolve()
      }
      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    })
  })
}

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
    // 只有在操作成功时才显示成功提示
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
