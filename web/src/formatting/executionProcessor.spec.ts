import {
  describe, it, expect 
} from 'vitest';
import { processExecutionData } from './executionProcessor';
import {
  buildExecution, buildEvent, buildCompletedExecution, buildDistributedMapExecution, buildKeywordProgress,
  buildLegacyExecution,
} from './executionProcessorFixtures';
import type { DistributedMapEvent } from './executionProcessorFixtures';

describe('processExecutionData', () => {
  describe('when execution is null', () => {
    it('returns 3 pending steps', () => {
      const result = processExecutionData(null);

      expect(result.steps).toHaveLength(3);
      expect(result.steps.every(s => s.status === 'pending')).toBe(true);
    });

    it.each([
      {
        name: 'returns the parse, keyword and summary steps in order',
        field: 'name',
        expected: ['ParseKeywords', 'ProcessKeywords', 'GenerateSummary'],
      },
      {
        name: 'describes the ProcessKeywords step as the per-keyword search, dedupe and crawl',
        field: 'description',
        expected: [undefined, 'Search, dedupe and crawl per keyword', undefined],
      },
    ] as const)('$name', ({
      field, expected 
    }) => {
      const result = processExecutionData(null);

      expect(result.steps.map(s => s[field])).toStrictEqual(expected);
    });
  });

  describe('when execution is running', () => {
    it.each([
      {
        name: 'marks step as running when TaskStarted event received',
        events: [{ type: 'TaskStarted' }],
        expected: { status: 'running' },
      },
      {
        name: 'marks step as completed when TaskSucceeded event received',
        events: [{ type: 'TaskStarted' }, { type: 'TaskSucceeded' }],
        expected: { status: 'completed' },
      },
      {
        name: 'marks step as failed when TaskFailed event received',
        events: [{ type: 'TaskStarted' }, {
          type: 'TaskFailed',
          error: 'Parse error'
        }],
        expected: {
          status: 'failed',
          error: 'Parse error'
        },
      },
    ])('$name', ({
      events, expected 
    }) => {
      const execution = buildExecution({
        events: events.map(event => buildEvent({
          ...event,
          state_name: 'ParseKeywords'
        })),
      });

      const result = processExecutionData(execution);

      expect(result.steps[0]).toMatchObject(expected);
    });

  });

  describe('Distributed Map workflow', () => {
    it.each<[DistributedMapEvent[], string[]]>([
      [['parseStarted'], ['running', 'pending', 'pending']],
      [['parseStarted', 'parseSucceeded', 'mapStateStarted'], ['completed', 'running', 'pending']],
      [['parseStarted', 'mapRunStarted'], ['completed', 'running', 'pending']],
      [['parseSucceeded', 'mapStateStarted', 'mapRunStarted', 'mapRunSucceeded'], ['completed', 'completed', 'pending']],
      [['parseSucceeded', 'mapRunStarted', 'mapStateExited'], ['completed', 'completed', 'pending']],
      [['parseSucceeded', 'mapRunStarted', 'mapRunFailed'], ['completed', 'failed', 'pending']],
      [['parseSucceeded', 'mapRunStarted', 'mapRunSucceeded', 'mapStateExited', 'summaryStarted'], ['completed', 'completed', 'running']],
    ])('derives the step states from %j', (names, expected) => {
      const result = processExecutionData(buildDistributedMapExecution(names));

      expect(result.steps.map(s => s.status)).toStrictEqual(expected);
    });

    it('records the map run error on the ProcessKeywords step when the map run fails', () => {
      const result = processExecutionData(buildDistributedMapExecution(['mapRunStarted', 'mapRunFailed']));

      expect(result.steps[1].error).toBe('States.ExceedToleratedFailureThreshold');
    });

    it('attaches the keyword counts to the ProcessKeywords step', () => {
      const progress = buildKeywordProgress();

      const result = processExecutionData(buildDistributedMapExecution(['mapRunStarted'], { progress }));

      expect(result.steps.map(s => s.keywords)).toStrictEqual([undefined, progress, undefined]);
    });

    it('leaves the ProcessKeywords step without counts when the status carries none', () => {
      const result = processExecutionData(buildDistributedMapExecution(['mapRunStarted'], { progress: null }));

      expect(result.steps[1].keywords).toBeUndefined();
    });
  });

  describe('legacy inline-Map histories', () => {
    it.each([
      ['TaskSucceeded', 'SearchAllProviders'],
      ['TaskSucceeded', 'DeduplicateCitations'],
      ['TaskSucceeded', 'CrawlSingleCitation'],
      ['MapStateExited', 'CrawlCitations'],
    ].map(([type, stateName]) => ({
      name: `keeps ProcessKeywords running when one keyword reports ${type} for ${stateName}`,
      type,
      stateName,
      expected: ['completed', 'running', 'pending'],
    })).concat({
      name: 'completes ProcessKeywords when the legacy keyword map exits',
      type: 'MapStateExited',
      stateName: 'ProcessKeywords',
      expected: ['completed', 'completed', 'pending'],
    }))('$name', ({
      type, stateName, expected 
    }) => {
      const execution = buildLegacyExecution([{
        type: 'TaskStarted',
        state_name: 'SearchAllProviders'
      }, {
        type,
        state_name: stateName
      }]);

      const result = processExecutionData(execution);

      expect(result.steps.map(s => s.status)).toStrictEqual(expected);
    });

    it('marks ProcessKeywords failed when a per-keyword task fails', () => {
      const execution = buildLegacyExecution([{
        type: 'TaskFailed',
        state_name: 'CrawlSingleCitation',
        error: 'States.Timeout' 
      }]);

      const result = processExecutionData(execution);

      expect(result.steps[1]).toMatchObject({
        status: 'failed',
        error: 'States.Timeout' 
      });
    });

    it('marks every step completed for a finished legacy run', () => {
      const result = processExecutionData(buildCompletedExecution());

      expect(result.steps.map(s => s.status)).toStrictEqual(['completed', 'completed', 'completed']);
    });
  });

  describe('event passthrough', () => {
    it('returns all events in events array', () => {
      const events = [
        buildEvent({ type: 'TaskStarted' }),
        buildEvent({ type: 'TaskSucceeded' }),
      ];
      const execution = buildExecution({ events });

      const result = processExecutionData(execution);

      expect(result.events).toStrictEqual(events);
    });

  });
});
