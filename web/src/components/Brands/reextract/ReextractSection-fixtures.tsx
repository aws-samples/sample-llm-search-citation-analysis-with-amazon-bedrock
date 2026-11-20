import {
  act, fireEvent, render, screen, within
} from '@testing-library/react';
import { buildGroup } from '../../../api/keywordGroups-fixtures';
import type { ReextractJob } from '../../../api/reextractDecoders';
import { buildReextractEstimate } from '../../../api/reextract-fixtures';
import { createMockJsonResponse } from '../../../test/fetchResponses';
import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';
import { ReextractSection } from './ReextractSection';

const GROUPS = [
  buildGroup({
    id: 'group-costamar',
    name: 'Costamar',
    keyword_count: 40,
  }),
  buildGroup({
    id: 'group-example-hotels',
    name: 'Example Hotels',
    keyword_count: 45,
  }),
];

interface ReplyFixture {
  readonly status: number;
  readonly body: unknown;
}

/** What the fake API answers on each re-extract route; change it between calls to model the job moving on. */
export interface ReextractApiFixture {
  job: ReextractJob | null;
  estimate: unknown;
  start: ReplyFixture;
  stop: unknown;
}

function fakeReextractApi(overrides: Partial<ReextractApiFixture>): ReextractApiFixture {
  const api: ReextractApiFixture = {
    job: null,
    estimate: buildReextractEstimate(),
    start: {
      status: 202,
      body: null,
    },
    stop: null,
    ...overrides,
  };
  mockAuthenticatedFetch.mockImplementation((url: string, init?: RequestInit) => Promise.resolve(reply(api, url, init?.method ?? 'GET')));
  return api;
}

function reply(api: ReextractApiFixture, url: string, method: string): Response {
  const path = url.replace('https://api.test.com', '');
  if (path === '/keyword-groups') return createMockJsonResponse({
    groups: GROUPS,
    count: GROUPS.length,
  });
  if (path === '/reextract' && method === 'GET') return createMockJsonResponse({
    job: api.job,
    active: api.job !== null && (api.job.status === 'running' || api.job.status === 'stopping'),
  });
  if (path === '/reextract/estimate') return createMockJsonResponse(api.estimate);
  if (path === '/reextract') return createMockJsonResponse(api.start.body, api.start.status);
  return createMockJsonResponse(api.stop);
}

/** The parsed bodies sent to `path` with `method`, in call order. */
export function sentBodies(path: string, method = 'POST'): unknown[] {
  return mockAuthenticatedFetch.mock.calls
    .filter(([url, init]) => url === `https://api.test.com${path}` && (init?.method ?? 'GET') === method)
    .map(([, init]) => parsedBody(init?.body));
}

function parsedBody(body: unknown): unknown {
  if (typeof body !== 'string') return undefined;
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

/** Lets pending fetches and the state updates after them settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/** Answers with `overrides` on the fake API, renders the section and lets its first reads settle. */
export async function renderReextractSection(overrides: Partial<ReextractApiFixture> = {}): Promise<ReextractApiFixture> {
  const api = fakeReextractApi(overrides);
  render(<ReextractSection />);
  await settle();
  return api;
}

/** Renders the section on the fake API and asks for an estimate of the default filters. */
export async function renderEstimated(overrides: Partial<ReextractApiFixture> = {}): Promise<ReextractApiFixture> {
  const api = await renderReextractSection(overrides);
  await clickEstimate();
  return api;
}

export function startButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Re-extract/ });
}

export async function clickEstimate(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));
  await settle();
}

export function pickGroup(name: string): void {
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^${name}`) }));
}

export function setFromDate(value: string): void {
  fireEvent.change(screen.getByLabelText('From'), { target: { value } });
}

/** Opens the confirmation dialog from the Start button and confirms it. */
export async function confirmStart(): Promise<void> {
  fireEvent.click(startButton());
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Re-extract' }));
  await settle();
}

export function jobPanel(): HTMLElement {
  return screen.getByRole('region', { name: 'Re-extract job' });
}
