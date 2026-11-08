import { signOut } from 'aws-amplify/auth';
import { ExportsBadge } from '../Exports/ExportsBadge';
import { MarketSelector } from '../Markets/MarketSelector';
import { PrintToPdfButton } from '../ui/PrintToPdfButton';
import { Spinner } from '../ui/Spinner';
import { ThemeToggle } from '../ui/ThemeToggle';

async function signOutQuietly() {
  try {
    await signOut();
  } catch (signOutError) {
    console.error('Sign out error:', signOutError);
  }
}

interface AppHeaderProps {
  readonly isPrintMode: boolean;
  readonly title: string;
  readonly lastUpdate: Date;
  readonly refreshing: boolean;
  readonly onToggleSidebar: () => void;
  readonly onShowAbout: () => void;
}

/** The page title bar: a bare title plus timestamp in print mode, the full toolbar otherwise. */
export function AppHeader({
  isPrintMode, title, lastUpdate, refreshing, onToggleSidebar, onShowAbout
}: AppHeaderProps) {
  if (isPrintMode) {
    return (
      <header className="px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200 dark:border-gray-700 print-header">
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
          {title}
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {new Date().toLocaleString()}
        </p>
      </header>
    );
  }

  return (
    <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 lg:px-8 sticky top-0 z-10">
      <button
        onClick={onToggleSidebar}
        className="lg:hidden p-2 -ml-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white truncate">{title}</h1>
      <div className="flex items-center gap-2 sm:gap-4">
        <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </span>
        {refreshing && (
          <span className="text-sm text-gray-400 flex items-center gap-2">
            <Spinner size="sm" />
            <span className="hidden sm:inline">Refreshing</span>
          </span>
        )}
        <PrintToPdfButton />
        <ExportsBadge />
        <MarketSelector />
        <ThemeToggle />
        <button
          onClick={signOutQuietly}
          className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title="Sign out"
        >
          <span className="hidden sm:inline">Sign Out</span>
          <svg className="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        </button>
        <button
          onClick={onShowAbout}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title="About this application"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </button>
      </div>
    </header>
  );
}
