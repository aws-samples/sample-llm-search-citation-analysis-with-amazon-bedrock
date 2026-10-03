import {
  createEvent, fireEvent, render, screen, within
} from '@testing-library/react';
import {
  MemoryRouter, Route, Routes
} from 'react-router-dom';
import { vi } from 'vitest';
import type { CustomReport } from '../../../api/customReports';
import { ALL_SCOPE } from '../../ui/reportScope';
import {
  CurrentLocation, SCOPE_KEYWORDS
} from '../scopeReport/scopeReport-fixtures';
import { CustomReportBuilder } from './CustomReportBuilder';
import { CustomReportView } from './CustomReportView';
import type {
  CompetitorSource, ReportSources
} from './reportSources';

/** No source mounted, every keyword over 90 days, unless overridden. */
export function buildReportSources(overrides: Partial<ReportSources> = {}): ReportSources {
  return {
    inputs: {
      scope: ALL_SCOPE,
      days: 90,
      competitor: null,
    },
    scope: null,
    overview: null,
    groupKpis: null,
    competitor: null,
    contentPlan: null,
    deepDive: null,
    ...overrides,
  };
}

/** Brand config loaded with no competitor configured, unless overridden. */
export function buildCompetitorSource(overrides: Partial<CompetitorSource> = {}): CompetitorSource {
  return {
    competitors: [],
    selected: null,
    gap: {
      competitor: null,
      rollup: null,
      keywordsAnalyzed: 0,
      loading: false,
      error: null,
      ready: true,
    },
    ready: true,
    ...overrides,
  };
}

/** The `GET /custom-reports` body for `reports`. */
export function reportsListPayload(...reports: CustomReport[]) {
  return { reports };
}

/**
 * The custom report pages routed as in `ReportsRouter`, opened at `path`,
 * with the current location beside them (any other path renders nothing).
 */
export function renderCustomReportRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/custom/new" element={<CustomReportBuilder />} />
        <Route path="/reports/custom/:id/edit" element={<CustomReportBuilder />} />
        <Route path="/reports/custom/:id" element={<CustomReportView keywords={SCOPE_KEYWORDS} />} />
        <Route path="*" element={null} />
      </Routes>
      <CurrentLocation />
    </MemoryRouter>,
  );
}

/** The `dataTransfer` a drag event needs, which jsdom does not provide. */
export function fakeDataTransfer() {
  return {
    setData: vi.fn(),
    effectAllowed: 'none',
    dropEffect: 'none',
  };
}

/** Starts dragging `element`. */
export function dragStartOn(element: Element): void {
  fireEvent.dragStart(element, { dataTransfer: fakeDataTransfer() });
}

/**
 * Drags over `element` at height `clientY`. jsdom has no `DragEvent` (so no
 * pointer position) and lays nothing out (every box is 0 high at 0): a
 * negative `clientY` is the top half of the element, a positive one its
 * bottom half.
 */
export function dragOverAt(element: Element, clientY: number): void {
  const event = createEvent.dragOver(element, { dataTransfer: fakeDataTransfer() });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(element, event);
}

/** Drops the dragged block on `element`. */
export function dropOn(element: Element): void {
  fireEvent.drop(element, { dataTransfer: fakeDataTransfer() });
}

/** The names of the blocks in the report being built, in order. */
export function canvasBlockNames(): string[] {
  return screen.queryAllByRole('button', { name: /^Remove / }).map((button) => (button.getAttribute('aria-label') ?? '').replace(/^Remove /u, ''));
}

function closestItem(element: HTMLElement): HTMLElement {
  const item = element.closest('li');
  if (item === null) throw new MissingFixtureElementError('list item');
  return item;
}

/** The block list entry offering `name` ("Sentiment · Headline", "Heading"). */
export function catalogItem(name: string): HTMLElement {
  return closestItem(screen.getByRole('button', { name: new RegExp(`^Add(ed)? ${name}$`, 'u') }));
}

/** The card of block `name` in the report being built. */
export function canvasCard(name: string): HTMLElement {
  return closestItem(screen.getByRole('button', { name: `Remove ${name}` }));
}

/** The drag handle (the heading) of block `name` in the report being built. */
export function canvasHandle(name: string): HTMLElement {
  return within(canvasCard(name)).getByTitle('Drag to move');
}

/** The drop zone under the report's blocks. */
export function dropZone(): HTMLElement {
  return screen.getByText(/^(Drop a block here|Your report is empty)/u);
}

export class MissingFixtureElementError extends Error {
  constructor(what: string) {
    super(`No ${what} found`);
    this.name = 'MissingFixtureElementError';
  }
}
