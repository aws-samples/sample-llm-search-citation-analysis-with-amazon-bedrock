import { signOut } from 'aws-amplify/auth';
import { ExportsBadge } from '../Exports/ExportsBadge';
import { MarketSelector } from '../Markets/MarketSelector';
import { PrintToPdfButton } from '../ui/PrintToPdfButton';
import { Spinner } from '../ui/Spinner';
import { ThemeToggle } from '../ui/ThemeToggle';
import {
  pageTitleText, type PageTitle
} from './pageTitle';

async function signOutQuietly() {
  try {
    await signOut();
  } catch (signOutError) {
    console.error('Sign out error:', signOutError);
  }
}

const ICON_BUTTON = 'p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500';

interface AppHeaderProps {
  readonly isPrintMode: boolean;
  readonly title: PageTitle;
  readonly lastUpdate: Date;
  readonly refreshing: boolean;
  readonly sidebarOpen: boolean;
  readonly onToggleSidebar: () => void;
  readonly onShowAbout: () => void;
}

/** The page name, after its sidebar group in muted text when it is one of the group's pages. */
function HeaderTitle({ title }: { readonly title: PageTitle }) {
  const Tag = title.ownHeader === true ? 'p' : 'h1';
  return (
    <Tag className="min-w-0 flex-1 truncate text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
      {title.group !== undefined && (
        <span className="font-normal text-gray-500 dark:text-gray-400">
          {title.group}
          <span className="mx-1.5 sm:mx-2">›</span>
        </span>
      )}
      {title.title}
    </Tag>
  );
}

/**
 * The page title bar: a bare title plus timestamp in print mode, the full toolbar otherwise. The toolbar reads
 * from the scope of the page (the market) to the page actions (PDF), the app settings (theme, About) and
 * Sign Out last.
 */
export function AppHeader({
  isPrintMode, title, lastUpdate, refreshing, sidebarOpen, onToggleSidebar, onShowAbout
}: AppHeaderProps) {
  if (isPrintMode) {
    return (
      <header className="px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200 dark:border-gray-700 print-header">
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
          {pageTitleText(title)}
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {new Date().toLocaleString()}
        </p>
      </header>
    );
  }

  return (
    <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 sm:gap-4 px-4 sm:px-6 lg:px-8 sticky top-0 z-10">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Open navigation"
        aria-controls="app-sidebar"
        aria-expanded={sidebarOpen}
        className={`lg:hidden -ml-2 ${ICON_BUTTON}`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <HeaderTitle title={title} />
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden md:inline mr-2">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </span>
        {refreshing && (
          <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 mr-2">
            <Spinner size="sm" />
            <span className="hidden sm:inline">Refreshing</span>
          </span>
        )}
        <MarketSelector />
        {/* A phone has no room for it and rarely prints; the browser's own print stays available there. */}
        {title.ownHeader !== true && <span className="hidden sm:inline-flex"><PrintToPdfButton /></span>}
        <ExportsBadge />
        <ThemeToggle />
        <button type="button" onClick={onShowAbout} aria-label="About this application" title="About this application" className={ICON_BUTTON}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </button>
        <button
          type="button"
          onClick={signOutQuietly}
          aria-label="Sign out"
          className="p-2 sm:px-3 sm:py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
        >
          <span className="hidden sm:inline">Sign Out</span>
          <svg className="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        </button>
      </div>
    </header>
  );
}
