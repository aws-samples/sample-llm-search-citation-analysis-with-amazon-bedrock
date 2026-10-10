import { useState } from 'react';
import {
  render, screen
} from '@testing-library/react';
import { vi } from 'vitest';
import {
  TabBar, TabPanel, type TabDefinition
} from './TabBar';
import { GLOBE_PATHS } from './iconPaths';

type AirlineId = 'altiplano' | 'condor' | 'sky';

export const PANEL_ID = 'airline-panel';

/** Three airline tabs: a plain one, one with an icon and a short label, one with a badge and its own accent. */
export const AIRLINE_TABS: ReadonlyArray<TabDefinition<AirlineId>> = [
  {
    id: 'altiplano',
    label: 'Altiplano Air',
  },
  {
    id: 'condor',
    label: 'Condor Sur',
    shortLabel: 'Condor',
    iconPaths: GLOBE_PATHS,
  },
  {
    id: 'sky',
    label: 'Sky Andes',
    badge: <span className="ml-2">3 new</span>,
    activeClassName: 'border-emerald-500 text-emerald-600',
  },
];

interface HarnessProps {
  readonly variant?: 'underline' | 'pill';
  readonly onChange: (id: AirlineId) => void;
  /** Renders a `TabPanel` the tabs control. */
  readonly withPanel?: boolean;
}

/** A tab bar whose selection lives in local state, as every site's does, so clicks and keys move it. */
function TabBarHarness({
  variant, onChange, withPanel = false
}: HarnessProps) {
  const [activeId, setActiveId] = useState<AirlineId>('altiplano');
  const change = (id: AirlineId) => {
    setActiveId(id);
    onChange(id);
  };
  return (
    <>
      <TabBar
        tabs={AIRLINE_TABS}
        activeId={activeId}
        onChange={change}
        label="Airline"
        variant={variant}
        panelId={withPanel ? PANEL_ID : undefined}
      />
      {withPanel && <TabPanel id={PANEL_ID} activeId={activeId}>Guide to {activeId}</TabPanel>}
    </>
  );
}

/** Renders the airline tabs, Altiplano Air selected; returns the `onChange` spy. */
export function renderTabBar(options: Omit<HarnessProps, 'onChange'> = {}) {
  const onChange = vi.fn();
  render(<TabBarHarness onChange={onChange} {...options} />);
  return onChange;
}

export function getTabElement(name: string | RegExp): HTMLElement {
  return screen.getByRole('tab', { name });
}

/** The text of every tab, in order. */
export function tabLabels(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
}

/** The `aria-selected` value of every tab, in order. */
export function selectedStates(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected') ?? '');
}
