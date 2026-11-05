import { Button } from '../ui/Button';
import {
  DASHBOARD_PANEL_LABELS, type DashboardPanel, type DashboardPanelStates
} from '../../hooks/dashboardPanels';

interface PanelLoadErrorProps {
  readonly panel: DashboardPanel;
  readonly panels: DashboardPanelStates;
  readonly onRetry: (panel: DashboardPanel) => Promise<void> | void;
  /** Margin classes, each followed by a space (e.g. `"mb-4 "`). */
  readonly spacingClassName?: string;
}

/**
 * "Citation and brand charts did not load: Request timed out." with a Retry
 * button, for one dashboard panel; renders nothing while that panel is fine.
 */
export function PanelLoadError({
  panel, panels, onRetry, spacingClassName = ''
}: PanelLoadErrorProps) {
  const {
    error, retrying 
  } = panels[panel];
  if (error === null) return null;
  return (
    <div
      role="alert"
      className={`${spacingClassName}flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700`}
    >
      <span>{DASHBOARD_PANEL_LABELS[panel]} did not load: {error}.</span>
      <Button variant="secondary" size="sm" className="print-hidden" disabled={retrying} onClick={() => { void onRetry(panel); }}>
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}
