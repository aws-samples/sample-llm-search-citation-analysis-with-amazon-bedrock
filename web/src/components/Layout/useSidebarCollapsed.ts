/**
 * Whether the desktop sidebar is collapsed to its icon rail, remembered in
 * `localStorage` across visits. Storage can be unavailable (private mode,
 * quota, a blocked origin): the sidebar then opens expanded and the choice
 * lasts for the visit only.
 */
import {
  useCallback, useState
} from 'react';

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

export function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Unavailable storage: the choice lasts for the visit only.
  }
}

export function useSidebarCollapsed(): {
  readonly collapsed: boolean;
  readonly toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const toggle = useCallback(() => {
    const next = !collapsed;
    storeCollapsed(next);
    setCollapsed(next);
  }, [collapsed]);
  return {
    collapsed,
    toggle,
  };
}
