import type { ReactNode } from 'react';
import {
  EXPORTS_CONTEXT, useExportsCenter
} from '../../hooks/useExports';
import { ExportToasts } from './ExportToasts';

/**
 * Mounts the one Exports center of the signed-in dashboard (live list, badge count, toasts) and
 * renders its toasts; every "Export all" button, the header badge and the Exports page read it.
 */
export function ExportsProvider({ children }: { readonly children: ReactNode }) {
  const center = useExportsCenter();
  return (
    <EXPORTS_CONTEXT.Provider value={center}>
      {children}
      <ExportToasts toasts={center.toasts} onDismiss={center.dismissToast} />
    </EXPORTS_CONTEXT.Provider>
  );
}
