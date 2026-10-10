import {
  useId, type KeyboardEvent, type ReactNode
} from 'react';
import { nextTabIndex } from '../AiAssistants/tabNavigation';
import { StrokeIcon } from './StrokeIcon';

export interface TabDefinition<TId extends string> {
  readonly id: TId;
  readonly label: ReactNode;
  /** Replaces `label` on narrow screens. */
  readonly shortLabel?: ReactNode;
  /** The `StrokeIcon` paths drawn before the label. */
  readonly iconPaths?: readonly string[];
  /** A count or status pill after the label; it brings its own left margin. */
  readonly badge?: ReactNode;
  /** Replaces the selected tab's colours (a per-tab accent). */
  readonly activeClassName?: string;
}

type TabBarVariant = 'underline' | 'pill';

interface TabBarProps<TId extends string> {
  readonly tabs: ReadonlyArray<TabDefinition<TId>>;
  readonly activeId: TId;
  readonly onChange: (id: TId) => void;
  /** Names the tab list for assistive technology. */
  readonly label: string;
  readonly variant?: TabBarVariant;
  /** The id of the `TabPanel` the tabs control, when the site renders one. */
  readonly panelId?: string;
  /** Layout classes of the frame around the list, such as a modal's horizontal padding. */
  readonly className?: string;
}

interface VariantStyle {
  readonly frame: string;
  readonly list: string;
  readonly tab: string;
  readonly active: string;
  readonly idle: string;
}

const VARIANTS: Record<TabBarVariant, VariantStyle> = {
  underline: {
    frame: 'border-b border-gray-200 dark:border-gray-700',
    list: '-mb-px flex gap-4 overflow-x-auto sm:gap-6',
    tab: 'border-b-2 px-1 py-3 focus-visible:ring-inset',
    active: 'border-gray-900 text-gray-900 dark:border-white dark:text-white',
    idle: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:hover:text-gray-300',
  },
  pill: {
    frame: '',
    list: 'flex flex-wrap items-center gap-2',
    tab: 'rounded-lg px-3 py-2',
    active: 'bg-gray-900 text-white',
    idle: 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900',
  },
};

const TAB_BASE = 'inline-flex shrink-0 items-center whitespace-nowrap text-sm font-medium transition-colors '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500';

/** A tab's element id, derived from the panel (or list) id so `TabPanel` can name its tab without a lookup. */
const tabElementId = (scope: string, id: string): string => `${scope}-tab-${id}`;

function TabLabel({
  label, shortLabel
}: Pick<TabDefinition<string>, 'label' | 'shortLabel'>) {
  if (shortLabel === undefined) return <span>{label}</span>;
  return (
    <>
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{shortLabel}</span>
    </>
  );
}

/**
 * A row of tabs (WAI-ARIA tabs pattern): one tab stop, arrow keys, Home and
 * End move between the tabs and select as they go. `underline` tabs sit on a
 * rule, `pill` tabs are filled buttons.
 */
export function TabBar<TId extends string>({
  tabs, activeId, onChange, label, variant = 'underline', panelId, className = ''
}: TabBarProps<TId>) {
  const listId = useId();
  const scope = panelId ?? listId;
  const style = VARIANTS[variant];
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(event.key, activeIndex, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next].id;
    onChange(target);
    document.getElementById(tabElementId(scope, target))?.focus();
  };

  return (
    <div className={`${style.frame} ${className}`.trim()}>
      <div role="tablist" aria-label={label} className={style.list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              id={tabElementId(scope, tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={`${TAB_BASE} ${style.tab} ${selected ? (tab.activeClassName ?? style.active) : style.idle}`}
            >
              {tab.iconPaths !== undefined && <StrokeIcon className="mr-2 h-4 w-4 shrink-0" paths={tab.iconPaths} />}
              <TabLabel label={tab.label} shortLabel={tab.shortLabel} />
              {tab.badge}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface TabPanelProps {
  /** The id handed to `TabBar` as `panelId`. */
  readonly id: string;
  readonly activeId: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** The content the selected tab of a `TabBar` controls, named by that tab. */
export function TabPanel({
  id, activeId, className, children
}: TabPanelProps) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={tabElementId(id, activeId)} className={className}>
      {children}
    </div>
  );
}
