/**
 * A sidebar entry that opens to its pages (SEO, Settings).
 *
 * Expanded sidebar: the entry links to its first page and opens the group; the chevron beside it only opens or
 * closes it. The pages are listed under the entry, indented on a guide line, with their counts and attention dots.
 * Collapsed to the icon rail (desktop): the icon opens a pop-out beside the rail listing the same pages, which
 * closes on Escape, a click outside or a choice. Mobile never collapses, so it always shows the inline list.
 */
import {
  useEffect, useId, useRef, useState, type ReactNode, type RefObject
} from 'react';
import { createPortal } from 'react-dom';
import { StrokeIcon } from '../ui/StrokeIcon';
import { CHEVRON_DOWN_PATHS } from '../ui/iconPaths';
import type { NavChild } from './sidebarChildren';

/** The rail is shown from this width up (Tailwind `lg`); below it the sidebar is a drawer and never a rail. */
const RAIL_MEDIA = '(min-width: 1024px)';

/** `classes` on desktop while the sidebar is collapsed to its rail; nothing otherwise. */
export const whenCollapsed = (collapsed: boolean, classes: string): string => (collapsed ? classes : '');

export const ATTENTION_LABEL = 'Needs configuration';

/** Amber dot on a page whose setup blocks analysis runs. */
export function AttentionDot({ className = '' }: { readonly className?: string }) {
  return <output aria-label={ATTENTION_LABEL} className={`inline-block w-2 h-2 shrink-0 rounded-full bg-amber-500 ${className}`} />;
}

interface Props {
  readonly label: string;
  readonly icon: ReactNode;
  readonly iconColor: string | undefined;
  readonly path: string;
  readonly items: readonly NavChild[];
  /** The child whose page is open; `null` when the group's page is not. */
  readonly activeChildId: string | null;
  readonly open: boolean;
  readonly collapsed: boolean;
  readonly rowClass: (active: boolean) => string;
  readonly onOpenGroup: () => void;
  readonly onToggle: () => void;
  readonly onNavigate: (path: string) => void;
}

function childClass(active: boolean): string {
  const state = active
    ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white font-medium'
    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
  return `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${state}`;
}

function ChildLink({
  item, active, onNavigate
}: {
  readonly item: NavChild;
  readonly active: boolean;
  readonly onNavigate: (path: string) => void;
}) {
  return (
    <a href={item.path} data-nav-child={item.id} aria-current={active ? 'page' : undefined} className={childClass(active)}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(item.path);
      }}>
      <StrokeIcon className={`w-4 h-4 shrink-0 ${item.iconColor}`} paths={item.iconPaths} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.needsAttention === true && <AttentionDot />}
      {item.badge !== undefined && item.badge > 0 && (
        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{item.badge}</span>
      )}
    </a>
  );
}

function ChildList({
  id, items, activeChildId, onNavigate, className
}: {
  readonly id?: string;
  readonly items: readonly NavChild[];
  readonly activeChildId: string | null;
  readonly onNavigate: (path: string) => void;
  readonly className: string;
}) {
  return (
    <ul id={id} className={className}>
      {items.map((item) => (
        <li key={item.id}><ChildLink item={item} active={item.id === activeChildId} onNavigate={onNavigate} /></li>
      ))}
    </ul>
  );
}

/** Where the pop-out opens: beside the rail, level with the entry's icon. */
interface Anchor {
  readonly top: number;
  readonly left: number;
}

/** Closes the pop-out on Escape or a press outside it and its entry. */
function useDismiss(open: boolean, refs: ReadonlyArray<RefObject<HTMLElement | null>>, close: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPress = (event: MouseEvent) => {
      if (!refs.some((ref) => ref.current?.contains(event.target as Node) === true)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPress);
    };
  }, [open, refs, close]);
}

function RailFlyout({
  id, label, anchor, items, activeChildId, panelRef, onNavigate
}: {
  readonly id: string;
  readonly label: string;
  readonly anchor: Anchor;
  readonly items: readonly NavChild[];
  readonly activeChildId: string | null;
  readonly panelRef: RefObject<HTMLElement | null>;
  readonly onNavigate: (path: string) => void;
}) {
  return createPortal(
    <nav ref={panelRef} id={id} aria-label={`${label} pages`}
      style={{
        top: anchor.top,
        left: anchor.left,
      }}
      className="fixed z-[60] w-60 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-lg">
      <p className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
      <ChildList items={items} activeChildId={activeChildId} onNavigate={onNavigate} className="space-y-0.5" />
    </nav>,
    document.body,
  );
}

export function SidebarGroup({
  label, icon, iconColor, path, items, activeChildId, open, collapsed, rowClass, onOpenGroup, onToggle, onNavigate
}: Props) {
  const listId = useId();
  const rowRef = useRef<HTMLAnchorElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const flyoutId = useId();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const refs = useRef([rowRef, panelRef]).current;
  const closeFlyout = () => setAnchor(null);
  useDismiss(anchor !== null, refs, closeFlyout);
  const active = activeChildId !== null;
  const attention = items.some((item) => item.needsAttention === true);

  const openRow = () => {
    if (collapsed && window.matchMedia(RAIL_MEDIA).matches) {
      const box = rowRef.current?.getBoundingClientRect();
      setAnchor(anchor === null && box !== undefined ? {
        top: box.top,
        left: box.right + 8,
      } : null);
      return;
    }
    onOpenGroup();
    onNavigate(path);
  };

  const navigate = (target: string) => {
    closeFlyout();
    onNavigate(target);
  };

  return (
    <div>
      <div className="relative">
        <a ref={rowRef} href={path} title={collapsed ? label : undefined}
          aria-expanded={collapsed ? anchor !== null : undefined} aria-controls={collapsed && anchor !== null ? flyoutId : undefined}
          className={`${rowClass(active)} pr-10 ${whenCollapsed(collapsed, 'lg:pr-0')}`}
          onClick={(event) => {
            event.preventDefault();
            openRow();
          }}>
          <span className={iconColor ?? 'text-gray-400'}>{icon}</span>
          <span className={whenCollapsed(collapsed, 'lg:sr-only')}>{label}</span>
          {attention && !open && <AttentionDot className={`ml-auto ${whenCollapsed(collapsed, 'lg:absolute lg:top-1.5 lg:right-2.5')}`} />}
        </a>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={listId}
          aria-label={`${open ? 'Hide' : 'Show'} ${label} pages`}
          className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 ${whenCollapsed(collapsed, 'lg:hidden')}`}>
          <StrokeIcon className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} paths={CHEVRON_DOWN_PATHS} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <ChildList id={listId} items={items} activeChildId={activeChildId} onNavigate={navigate}
          className={`mt-1 ml-5 pl-2.5 border-l border-gray-200 dark:border-gray-700 space-y-0.5 ${whenCollapsed(collapsed, 'lg:hidden')}`} />
      )}
      {anchor !== null && (
        <RailFlyout id={flyoutId} label={label} anchor={anchor} items={items} activeChildId={activeChildId} panelRef={panelRef}
          onNavigate={navigate} />
      )}
    </div>
  );
}
