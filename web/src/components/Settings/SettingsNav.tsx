import { Link } from 'react-router-dom';
import { Skeleton } from '../ui/Skeleton';
import { StrokeIcon } from '../ui/StrokeIcon';

export interface SettingsNavItem {
  /** Stable key; also the `data-section` hook for tests. */
  readonly id: string;
  readonly to: string;
  readonly label: string;
  /**
   * One short line under the label: what the section holds or its state
   * ("54 keywords", "9 of 9 enabled"). `null` while that state is loading —
   * a placeholder of the same height keeps the nav from shifting.
   */
  readonly caption: string | null;
  readonly iconPaths: readonly string[];
  /** Tailwind text colour for the icon: the section's accent tone (docs/design-system.md §2.2). */
  readonly iconColor: string;
  readonly needsAttention?: boolean;
}

export interface SettingsNavGroup {
  readonly title: string;
  readonly items: readonly SettingsNavItem[];
}

interface SettingsNavProps {
  readonly groups: readonly SettingsNavGroup[];
  readonly activeId: string;
}

/** Notification bubble on sections whose configuration blocks analysis runs. */
const AttentionDot = () => (
  <output
    aria-label="Needs configuration"
    className="ml-auto inline-block w-2 h-2 shrink-0 rounded-full bg-amber-500"
  />
);

function itemClass(active: boolean): string {
  const base = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap md:whitespace-normal';
  return active
    ? `${base} bg-gray-100 text-gray-900 font-medium`
    : `${base} text-gray-600 hover:bg-gray-50 hover:text-gray-900`;
}

const NavCaption = ({ caption }: { readonly caption: string | null }) => {
  if (caption === null) {
    return <Skeleton className="hidden md:block h-3 w-20 mt-1" />;
  }
  return <span className="hidden md:block text-xs font-normal text-gray-500 truncate">{caption}</span>;
};

const NavItemLink = ({
  item, active
}: {
  readonly item: SettingsNavItem;
  readonly active: boolean 
}) => (
  <Link
    to={item.to}
    aria-current={active ? 'page' : undefined}
    data-section={item.id}
    className={itemClass(active)}
  >
    <StrokeIcon className={`w-5 h-5 shrink-0 ${item.iconColor}`} paths={item.iconPaths} aria-hidden="true" />
    <span className="min-w-0 flex-1">
      <span className="block">{item.label}</span>
      <NavCaption caption={item.caption} />
    </span>
    {item.needsAttention && <AttentionDot />}
  </Link>
);

/**
 * The Settings section list: grouped and vertical beside the content on
 * medium screens and up, a single scrollable row of labels on phones. Every
 * entry is a link, so a section can be opened in a new tab or bookmarked.
 */
export const SettingsNav = ({
  groups, activeId
}: SettingsNavProps) => (
  <nav
    aria-label="Settings sections"
    className="bg-white rounded-lg border border-gray-200 p-2 md:p-3 flex gap-1 overflow-x-auto md:block md:space-y-4 md:overflow-visible"
  >
    {groups.map((group) => (
      <div key={group.title} className="contents md:block">
        <p className="hidden md:block px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {group.title}
        </p>
        <ul className="contents md:block md:space-y-0.5">
          {group.items.map((item) => (
            <li key={item.id} className="shrink-0">
              <NavItemLink item={item} active={item.id === activeId} />
            </li>
          ))}
        </ul>
      </div>
    ))}
  </nav>
);
