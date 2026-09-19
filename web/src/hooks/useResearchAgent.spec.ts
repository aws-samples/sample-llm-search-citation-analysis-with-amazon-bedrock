import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { AGENT_POLL_INTERVAL_MS } from './useResearchAgent';
import { buildAgentJob } from '../components/KeywordResearch/agent/agent-fixtures';
import type { StartAgentRequest } from '../api/keywordResearch';
import {
  advanceBy, openRun, renderAgentRuns, requests
} from './useResearchAgent-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const START_REQUEST: StartAgentRequest = {
  seed: 'Hotel Gran Marino',
  country: 'es',
  language: 'es',
  dimensions: ['destination'],
  instruction: '',
  targetCount: 60,
  trackingCount: 15,
  maxRounds: 2,
  templateId: 'builtin-default',
  systemPrompt: null,
  groupId: null,
};

describe('useResearchAgent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the agent runs from history on mount', async () => {
    const result = await renderAgentRuns({ history: [buildAgentJob()] });

    expect(result.current.jobs.map((job) => job.id)).toStrictEqual(['job-a']);
    expect(requests()[0]).toBe('GET /keyword-research/history?limit=50&type=agent');
  });

  it('starting a run prepends it to the list without opening it', async () => {
    const result = await renderAgentRuns({
      history: [buildAgentJob()],
      snapshots: {
        'job-new': [buildAgentJob({
          id: 'job-new',
          status: 'pending',
        })],
      },
    });

    await act(async () => {
      await result.current.start(START_REQUEST);
    });

    expect(result.current.jobs.map((job) => job.id)).toStrictEqual(['job-new', 'job-a']);
    expect(result.current.selectedId).toBeNull();
    expect(result.current.selected).toBeNull();
  });

  it('re-reads active runs on the poll interval until they finish', async () => {
    const result = await renderAgentRuns({
      history: [buildAgentJob({
        id: 'job-r',
        status: 'running',
        keyword_count: 5,
      })],
      snapshots: {
        'job-r': [
          buildAgentJob({
            id: 'job-r',
            status: 'running',
            keyword_count: 20,
          }),
          buildAgentJob({
            id: 'job-r',
            status: 'completed',
          }),
        ],
      },
    });
    expect(result.current.jobs).toHaveLength(1);

    await advanceBy(AGENT_POLL_INTERVAL_MS);
    expect(result.current.jobs[0].keyword_count).toBe(20);

    await advanceBy(AGENT_POLL_INTERVAL_MS);
    expect(result.current.jobs[0].status).toBe('completed');

    const polls = requests().filter((request) => request === 'GET /keyword-research/job-r').length;
    await advanceBy(AGENT_POLL_INTERVAL_MS * 2);
    expect(requests().filter((request) => request === 'GET /keyword-research/job-r')).toHaveLength(polls);
  });

  it('opening a run loads its full detail including the prompt', async () => {
    const result = await renderAgentRuns({
      history: [buildAgentJob({ system_prompt: undefined })],
      snapshots: { 'job-a': [buildAgentJob({ system_prompt: 'the snapshot' })] },
    });
    expect(result.current.jobs).toHaveLength(1);

    await openRun(result, 'job-a');

    expect(result.current.selected?.system_prompt).toBe('the snapshot');
  });

  it('retrying a run marks it pending and re-reads it', async () => {
    const partial = buildAgentJob({ status: 'partial' });
    const result = await renderAgentRuns({
      history: [partial],
      snapshots: { 'job-a': [buildAgentJob({ status: 'running' })] },
    });
    expect(result.current.jobs).toHaveLength(1);

    await act(async () => {
      await result.current.retry(partial);
    });

    expect(requests()).toContain('POST /keyword-research/job-a/retry');
    expect(result.current.jobs[0].status).toBe('running');
    expect(result.current.selectedId).toBe('job-a');
  });

  it('deleting the opened run closes it', async () => {
    const result = await renderAgentRuns({
      history: [buildAgentJob()],
      snapshots: { 'job-a': [buildAgentJob()] },
    });
    expect(result.current.jobs).toHaveLength(1);
    await openRun(result, 'job-a');

    await act(async () => {
      await result.current.remove('job-a');
    });

    expect(result.current.jobs).toStrictEqual([]);
    expect(result.current.selectedId).toBeNull();
  });

  it('surfaces a start failure as an error and keeps the list', async () => {
    const result = await renderAgentRuns({
      history: [buildAgentJob()],
      startError: { error: 'Keyword group not found' },
    });
    expect(result.current.jobs).toHaveLength(1);

    await act(async () => {
      await result.current.start({
        ...START_REQUEST,
        groupId: 'nope',
      });
    });

    expect(result.current.error).toBe('Keyword group not found');
    expect(result.current.jobs).toHaveLength(1);
  });
});
