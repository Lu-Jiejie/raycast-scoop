import { exec } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { promisify } from 'node:util'

export const execPromise = promisify(exec)

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
