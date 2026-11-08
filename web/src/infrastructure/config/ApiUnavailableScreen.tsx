import { StrokeIcon } from '../../components/ui/StrokeIcon';
import { WARNING_PATHS } from '../../components/ui/iconPaths';

interface ApiUnavailableScreenProps {readonly onRetry: () => void;}

/** Shown before the app while the dashboard has no API URL (`/config.json` not deployed yet). */
export function ApiUnavailableScreen({ onRetry }: ApiUnavailableScreenProps) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 max-w-md text-center">
        <div className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-500">
          <StrokeIcon paths={WARNING_PATHS} aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">The API is being updated</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          The dashboard cannot reach its API yet. During an upgrade this takes a few minutes; the page keeps checking and opens the dashboard when the API is back.
        </p>
        <button
          type="button"
          onClick={() => onRetry()}
          className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
        >
          Check again
        </button>
      </div>
    </div>
  );
}
