/**
 * Browser notifications for finished exports. Permission is only ever asked from the Exports
 * page ("Notify me in the browser"), never on load; without it the toast and badge still show.
 */
import { EXPORT_VIEW_LABELS } from '../components/Exports/exportViewLabels';
import type { ExportSummary } from '../types/domain/exports';

/** The browser's permission, or `unsupported` where there is no Notification API. */
export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

export function browserNotificationPermission(): BrowserNotificationPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Asks for permission (from a click on the Exports page) and resolves the answer. */
export async function requestBrowserNotifications(): Promise<BrowserNotificationPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

/** "Citations export is ready" / "Citations export failed". */
export function finishedExportTitle(summary: ExportSummary): string {
  const what = EXPORT_VIEW_LABELS[summary.view];
  return summary.status === 'ready' ? `${what} export is ready` : `${what} export failed`;
}

/** Shows a browser notification for a finished export when the user allowed them. */
export function notifyExportFinished(summary: ExportSummary): void {
  if (browserNotificationPermission() !== 'granted') return;
  const body = summary.status === 'ready' ? summary.filename : (summary.error ?? 'Open Exports for details');
  new Notification(finishedExportTitle(summary), {
    body,
    tag: summary.export_id,
  });
}
