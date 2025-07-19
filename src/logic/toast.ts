import { showToast, Toast } from '@raycast/api'

/**
 * Unified toast message templates for consistent UI messaging across the app
 */
export const ToastMessages = {
  // Version check related messages
  VERSION_CHECK: {
    LOADING: (appName: string) => ({ title: 'Checking for Updates', message: `Checking ${appName} for new version...` }),
    NEW_AVAILABLE: (appName: string, version: string) => ({ title: 'Update Available', message: `${appName} has a new version: ${version}` }),
    UP_TO_DATE: (appName: string) => ({ title: 'Up to Date', message: `${appName} is already on the latest version` }),
    FAILED: (appName: string, error?: string) => ({
      title: 'Check Failed',
      message: `Failed to check ${appName} for updates${error ? `: ${error}` : ''}`,
    }),
    COMPLETED: (count: number) => ({
      title: 'Check Completed',
      message: count > 0 ? `Found ${count} apps with updates available` : 'All apps are up-to-date',
    }),
  },

  // Update related messages
  APP_UPDATE: {
    LOADING: (appName: string, version?: string) => ({
      title: 'Updating App',
      message: version ? `Updating ${appName} to version ${version}...` : `Updating ${appName}...`,
    }),
    SUCCESS: (appName: string, version?: string) => ({
      title: 'Update Completed',
      message: version ? `Successfully updated ${appName} to version ${version}` : `Successfully updated ${appName}`,
    }),
    FAILED: (appName: string, error?: string) => ({
      title: 'Update Failed',
      message: error ? `Failed to update ${appName}: ${error}` : `Failed to update ${appName}`,
    }),
  },
  APP_UNINSTALL: {
    LOADING: (appName: string) => ({ title: 'App Uninstalling', message: `Uninstalling ${appName}...` }),
    SUCCESS: (appName: string) => ({ title: 'App Uninstalled', message: `Successfully uninstalled ${appName}` }),
    FAILED: (appName: string, error?: string) => ({
      title: 'Uninstall Failed',
      message: error ? `Failed to uninstall ${appName}: ${error}` : `Failed to uninstall ${appName}`,
    }),
  },
  APP_RESET: {
    LOADING: (appName: string) => ({ title: 'App Resetting', message: `Resetting ${appName}...` }),
    SUCCESS: (appName: string) => ({ title: 'App Reset', message: `Successfully reset ${appName}` }),
    FAILED: (appName: string, error?: string) => ({
      title: 'Reset Failed',
      message: error ? `Failed to reset ${appName}: ${error}` : `Failed to reset ${appName}`,
    }),
  },

  APP_LIST: {
    LOADING_FAILED: (error?: string) => ({
      title: 'Error Loading Apps',
      message: error ? `Failed to load Scoop apps: ${error}` : 'Failed to load Scoop apps',
    }),
    REFRESH_LOADING: () => ({ title: 'Reloading App List', message: 'Refreshing Scoop app list...' }),
    REFRESH_COMPLETED: () => ({ title: 'App List Reloaded', message: 'Successfully refreshed the app list' }),
  },
  BULK_UPDATE: {
    UPDATING: () => ({
      title: 'Checking for Updates',
      message: 'Checking all apps for new versions...',
    }),
    COMPLETED: (count: number) => ({
      title: 'Bulk Update Completed',
      message: `Finished checking ${count} apps for updates`,
    }),

  },
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
