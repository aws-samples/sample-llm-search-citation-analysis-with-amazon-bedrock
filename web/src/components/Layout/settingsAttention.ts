/**
 * Which Settings sections need setup that blocks analysis runs (no own brand, no AI provider key), for the
 * sidebar's attention dots. The Settings page knows it (it loads the brand config and the providers) and
 * publishes it to this small store; the sidebar reads it, so the sidebar never fetches either itself. Until the
 * Settings page has been opened once the set is empty: a dot never flashes a false alarm.
 */
import {
  useEffect, useSyncExternalStore
} from 'react';
import type { SettingsTab } from '../Settings/settingsSections';

const store: { sections: ReadonlySet<SettingsTab> } = { sections: new Set() };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replaces the published sections; listeners hear of it only when the set changed. */
export function publishSettingsAttention(sections: readonly SettingsTab[]): void {
  const next = new Set(sections);
  if (next.size === store.sections.size && [...next].every((section) => store.sections.has(section))) return;
  store.sections = next;
  listeners.forEach((listener) => listener());
}

/** The sections that need setup, as last published by the Settings page. */
export function useSettingsAttention(): ReadonlySet<SettingsTab> {
  return useSyncExternalStore(subscribe, () => store.sections);
}

/** Publishes `sections` whenever they change. */
export function usePublishSettingsAttention(sections: readonly SettingsTab[]): void {
  const key = sections.join(',');
  useEffect(() => {
    publishSettingsAttention(key === '' ? [] : sections);
    // `key` stands for the sections' content: a new array with the same sections publishes nothing new.
  }, [key]);
}
