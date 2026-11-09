import { useState } from 'react';
import {
  Link, useLocation
} from 'react-router-dom';
import { useExports } from '../../hooks/useExports';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import type { TabType } from '../../types';
import { useMarketSelection } from '../Markets/marketSelectionContext';
import { CloseIcon } from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  CHART_BAR_PATHS, CHEVRON_DOUBLE_LEFT_PATHS
} from '../ui/iconPaths';
import { useSettingsAttention } from './settingsAttention';
import { activeChildId } from './sidebarChildren';
import {
  SidebarGroup, whenCollapsed, type RowState
} from './SidebarGroup';
import {
  buildNavSections, type NavItem, navIconClass
} from './sidebarNav';
import { useSidebarCollapsed } from './useSidebarCollapsed';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  /** Opens a page by its path (a page of an SEO or Settings group), through the same leave check as a tab. */
  onNavigate: (path: string) => void;
  keywordsCount: number;
  schedulesCount: number;
  isRunning: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

const HOVER_CLASSES = 'hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

/**
 * A row's colours: highlighted for the open page; for a group entry while one of its pages is open, a strong label
 * without the highlight (on the rail, where the pages are hidden, the highlight too); muted otherwise.
 */
function rowStateClass(state: RowState, collapsed: boolean): string {
  if (state === 'active') return 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white';
  if (state === 'within') return `text-gray-900 dark:text-white ${HOVER_CLASSES} ${whenCollapsed(collapsed, 'lg:bg-gray-100 lg:dark:bg-gray-700')}`;
  return `text-gray-600 dark:text-gray-300 ${HOVER_CLASSES}`;
}

function linkClass(state: RowState, collapsed: boolean): string {
  return `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500 ${rowStateClass(state, collapsed)} ${whenCollapsed(collapsed, 'lg:justify-center lg:px-0')}`;
}

/** The link's tooltip on the rail: its label and count ("Schedule (3)"). */
function railTitle(item: NavItem): string {
  return item.badge !== undefined && item.badge > 0 ? `${item.label} (${item.badge})` : item.label;
}

/** The count pill; on the rail it shrinks to a dot on the icon, the count kept for screen readers. */
function Badge({
  count, collapsed
}: {
  readonly count: number;
  readonly collapsed: boolean;
}) {
  const rail = 'lg:absolute lg:top-1.5 lg:right-2.5 lg:h-2 lg:w-2 lg:p-0 lg:bg-gray-400 lg:dark:bg-gray-400';
  return (
    <span className={`ml-auto text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full ${whenCollapsed(collapsed, rail)}`}>
      <span className={whenCollapsed(collapsed, 'lg:sr-only')}>{count}</span>
    </span>
  );
}

function RunningDot({ collapsed }: { readonly collapsed: boolean }) {
  return (
    <span aria-hidden="true" className={`ml-auto relative h-2 w-2 ${whenCollapsed(collapsed, 'lg:absolute lg:top-1.5 lg:right-2.5')}`}>
      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="absolute inset-0 rounded-full bg-emerald-500" />
    </span>
  );
}

function NavLink({
  item, active, collapsed, isRunning, onClick
}: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly isRunning: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Link
      to={item.path}
      title={collapsed ? railTitle(item) : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        // Let onTabChange handle the navigation logic (for execution confirmation)
        e.preventDefault();
        onClick();
      }}
      className={linkClass(active ? 'active' : 'idle', collapsed)}
    >
      <span className={navIconClass(item.iconColor, active)}>
        {item.icon}
      </span>
      <span className={whenCollapsed(collapsed, 'lg:sr-only')}>{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && <Badge count={item.badge} collapsed={collapsed} />}
      {item.id === 'execution' && isRunning && <RunningDot collapsed={collapsed} />}
    </Link>
  );
}

/**
 * The app navigation. On desktop it can collapse to a 4 rem icon rail (the
 * choice is remembered); `main` follows its width through the `peer` /
 * `data-collapsed` attribute. On mobile it slides out over the page.
 */
/** The groups with pages; one is open at a time. */
type GroupId = 'seo' | 'settings';

const isGroup = (tab: TabType): tab is GroupId => tab === 'seo' || tab === 'settings';

/**
 * The open group: the one of the page on screen, unless the user opened or closed one since that page opened
 * (a choice kept until the next page change).
 */
function useOpenGroup(activeTab: TabType) {
  const [choice, setChoice] = useState<{
    readonly forTab: TabType;
    readonly open: GroupId | null;
  } | null>(null);
  const pageGroup = isGroup(activeTab) ? activeTab : null;
  const openGroup = choice !== null && choice.forTab === activeTab ? choice.open : pageGroup;
  return {
    openGroup,
    setOpenGroup: (open: GroupId | null, forTab: TabType = activeTab) => setChoice({
      forTab,
      open,
    }),
  };
}

export const Sidebar = ({
  activeTab, onTabChange, onNavigate, keywordsCount, schedulesCount, isRunning, isOpen, onToggle
}: SidebarProps) => {
  const {
    collapsed, toggle
  } = useSidebarCollapsed();
  const { pathname } = useLocation();
  const { isAdmin } = useIsAdmin();
  const { catalog } = useMarketSelection();
  const attention = useSettingsAttention();
  const exportsUnseen = useExports()?.unseenCount ?? 0;
  const {
    openGroup, setOpenGroup
  } = useOpenGroup(activeTab);
  const closeOnMobile = () => {
    if (window.innerWidth < 1024) onToggle();
  };
  const handlePathClick = (path: string) => {
    onNavigate(path);
    closeOnMobile();
  };
  // Close sidebar on mobile when tab changes
  const handleTabClick = (tab: TabType) => {
    onTabChange(tab);
    // Close sidebar on mobile after selection
    if (window.innerWidth < 1024) {
      onToggle();
    }
  };

  const navSections = buildNavSections({
    schedulesCount,
    exportsUnseen,
    settings: {
      isAdmin,
      keywordsCount,
      marketCount: catalog.loaded ? catalog.markets.length : null,
      attention,
    },
  });

  const renderItem = (item: NavItem) => {
    if (item.children === undefined || !isGroup(item.id)) {
      return (
        <NavLink item={item} active={activeTab === item.id} collapsed={collapsed} isRunning={isRunning}
          onClick={() => handleTabClick(item.id)} />
      );
    }
    const group = item.id;
    return (
      <SidebarGroup label={item.label} icon={item.icon} iconColor={item.iconColor} path={item.path} items={item.children}
        activeChildId={activeTab === group ? activeChildId(group, pathname) : null} open={openGroup === group}
        collapsed={collapsed} rowClass={(state) => linkClass(state, collapsed)}
        onOpenGroup={() => setOpenGroup(group, group)}
        onToggle={() => setOpenGroup(openGroup === group ? null : group)}
        onNavigate={handlePathClick} />
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        id="app-sidebar"
        data-collapsed={collapsed}
        className={`peer fixed left-0 top-0 h-screen w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col z-50 transform transition-[transform,width,visibility] duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full max-lg:invisible'
        } lg:translate-x-0 ${whenCollapsed(collapsed, 'lg:w-16')}`}
      >
        {/* Logo / Brand */}
        <div className={`h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-gray-700 ${whenCollapsed(collapsed, 'lg:justify-center lg:px-0')}`}>
          <div className={`flex items-center gap-3 min-w-0 ${whenCollapsed(collapsed, 'lg:hidden')}`}>
            <div className="w-8 h-8 shrink-0 bg-gray-900 dark:bg-white rounded-lg flex items-center justify-center">
              <StrokeIcon className="w-5 h-5 text-white dark:text-gray-900" paths={CHART_BAR_PATHS} strokeWidth={2} aria-hidden="true" />
            </div>
            <span className="font-semibold text-gray-900 dark:text-white truncate">Citation Analysis</span>
          </div>
          {/* Collapse / expand: desktop only (mobile slides out instead) */}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:inline-flex p-1.5 -mr-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            <StrokeIcon className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} paths={CHEVRON_DOUBLE_LEFT_PATHS} aria-hidden="true" />
          </button>
          {/* Close button for mobile */}
          <button
            onClick={onToggle}
            aria-label="Close sidebar"
            className="lg:hidden p-2 -mr-2 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Navigation */}
        <nav aria-label="Main navigation" className={`flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden dark:[color-scheme:dark] ${whenCollapsed(collapsed, 'lg:px-2')}`}>
          {navSections.map((section, sectionIdx) => (
            <div key={section.title} className={sectionIdx > 0 ? `mt-6 ${whenCollapsed(collapsed, 'lg:mt-3')}` : ''}>
              <div className={`px-3 mb-2 ${whenCollapsed(collapsed, 'lg:hidden')}`}>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {section.title}
                </span>
              </div>
              {collapsed && sectionIdx > 0 && <div aria-hidden="true" className="hidden lg:block mx-2 mb-3 border-t border-gray-100 dark:border-gray-700" />}
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.id}>{renderItem(item)}</li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

      </aside>
    </>
  );
};
