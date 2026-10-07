import {
  createEvent, fireEvent, render, screen, within
} from '@testing-library/react';
import {
  MemoryRouter, Route, Routes
} from 'react-router-dom';
import { vi } from 'vitest';
import { mockApiGet } from '../../../api/clientMock-fixtures';
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
    insights: null,
    ...overrides,
  };
}

/** Brand config loaded with no competitor configured, unless overridden. */
export function buildCompetitorSource(overrides: Partial<CompetitorSource> = {}): CompetitorSource {
  return {
    competitors: [],
    selected: null,
    gap: {
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

/** What a custom report page says when no saved report has its id. */
export const REPORT_GONE = 'This report no longer exists. It may have been deleted.';

/** `renderCustomReportRoute(path)` with no report saved. */
export function renderWithoutSavedReports(path: string) {
  mockApiGet.mockResolvedValue(reportsListPayload());
  return renderCustomReportRoute(path);
}

/** The text of every level-2 heading, top to bottom. */
export function sectionHeadingTexts(): (string | null)[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
}

/** The `dataTransfer` a drag event needs, which jsdom does not provide. */
function fakeDataTransfer() {
  return {
    setData: vi.fn(),
    effectAllowed: 'none',
    dropEffect: 'none',
  };
}

/** Starts dragging `element`. */
function dragStartOn(element: Element): void {
  fireEvent.dragStart(element, { dataTransfer: fakeDataTransfer() });
}

/**
 * Drags over `element` at height `clientY`. jsdom has no `DragEvent` (so no
 * pointer position) and lays nothing out (every box is 0 high at 0): a
 * negative `clientY` is the top half of the element, a positive one its
 * bottom half.
 */
function dragOverAt(element: Element, clientY: number): void {
  const event = createEvent.dragOver(element, { dataTransfer: fakeDataTransfer() });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(element, event);
}

/** Drags `source` over `over` at height `clientY` (see `dragOverAt`), then drops it on `target`. */
export function dragAndDrop(source: Element, over: Element, clientY: number, target: Element = over): void {
  dragStartOn(source);
  dragOverAt(over, clientY);
  fireEvent.drop(target, { dataTransfer: fakeDataTransfer() });
}

/** The list of blocks in the report being built. */
export function reportCanvas(): HTMLElement {
  return screen.getByRole('list', { name: 'Your report' });
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

class MissingFixtureElementError extends Error {
  constructor(what: string) {
    super(`No ${what} found`);
    this.name = 'MissingFixtureElementError';
  }
}
