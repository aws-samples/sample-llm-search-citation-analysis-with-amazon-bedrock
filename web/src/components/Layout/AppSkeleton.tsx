import {
  Skeleton, SkeletonPage
} from '../ui/Skeleton';
import { readStoredCollapsed } from './useSidebarCollapsed';

const NAV_PLACEHOLDERS = ['nav-1', 'nav-2', 'nav-3', 'nav-4', 'nav-5', 'nav-6', 'nav-7', 'nav-8', 'nav-9', 'nav-10'];

/**
 * The app frame drawn while the first dashboard data loads: sidebar, header
 * bar and a page placeholder at their real sizes, so the first paint already
 * has the final layout instead of a blank "Loading" screen.
 */
export const AppSkeleton = () => {
  // A sidebar remembered as the icon rail loads as the rail, so the page does not shift when the app appears.
  const collapsed = readStoredCollapsed();
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <aside aria-hidden="true" className={`hidden lg:flex fixed left-0 top-0 h-screen ${collapsed ? 'w-16' : 'w-64'} flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700`}>
        <div className={`h-16 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 ${collapsed ? 'justify-center' : 'px-6'}`}>
          <Skeleton className="w-8 h-8 rounded-lg" />
          {!collapsed && <Skeleton className="h-4 w-32" />}
        </div>
        <div className={`py-6 space-y-5 ${collapsed ? '' : 'px-6'}`}>
          {NAV_PLACEHOLDERS.map((id) => (
            <div key={id} className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
              <Skeleton className="w-5 h-5" />
              {!collapsed && <Skeleton className="h-3.5 w-28" />}
            </div>
          ))}
        </div>
      </aside>
      <main className={`${collapsed ? 'lg:ml-16' : 'lg:ml-64'} min-h-screen`}>
        <div aria-hidden="true" className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-48 hidden sm:block" />
        </div>
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <SkeletonPage label="Loading dashboard" />
          </div>
        </div>
      </main>
    </div>
  );
};
