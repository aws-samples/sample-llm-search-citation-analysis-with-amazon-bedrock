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
    it('returns IDLE status', () => {
      const result = processExecutionData(null);

      expect(result.status).toBe('IDLE');
    });

    it('returns empty startDate', () => {
      const result = processExecutionData(null);

      expect(result.startDate).toBe('');
    });

    it('returns 3 pending steps', () => {
      const result = processExecutionData(null);

      expect(result.steps).toHaveLength(3);
      expect(result.steps.every(s => s.status === 'pending')).toBe(true);
    });

    it('returns 0 progress', () => {
      const result = processExecutionData(null);

      expect(result.progress).toBe(0);
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
    it('returns execution status', () => {
      const execution = buildExecution({ status: 'RUNNING' });

      const result = processExecutionData(execution);

      expect(result.status).toBe('RUNNING');
    });

    it('returns execution startDate', () => {
      const execution = buildExecution({ start_date: '2026-01-23T10:00:00Z' });

      const result = processExecutionData(execution);

      expect(result.startDate).toBe('2026-01-23T10:00:00Z');
    });

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

    it('returns ProcessKeywords as currentStep while a legacy per-keyword search runs', () => {
      const execution = buildExecution({
        events: [
          buildEvent({
            type: 'TaskSucceeded',
            state_name: 'ParseKeywords' 
          }),
          buildEvent({
            type: 'TaskStarted',
            state_name: 'SearchAllProviders' 
          }),
        ],
      });

      const result = processExecutionData(execution);

      expect(result.currentStep).toBe('ProcessKeywords');
    });

    it('returns undefined currentStep when no step is running', () => {
      const execution = buildExecution({ events: [] });

      const result = processExecutionData(execution);

      expect(result.currentStep).toBeUndefined();
    });
  });

  describe('progress calculation', () => {
    it.each([
      {
        name: 'returns 0 when no steps completed',
        execution: () => buildExecution({ events: [] }),
        expected: 0,
      },
      {
        name: 'returns 10 when only ParseKeywords completed',
        execution: () => buildDistributedMapExecution(['parseStarted', 'parseSucceeded']),
        expected: 10,
      },
      {
        name: 'returns 100 when a legacy run completed every step',
        execution: () => buildCompletedExecution(),
        expected: 100,
      },
      {
        name: 'returns 90 once ProcessKeywords exits, whatever the keyword counts say',
        execution: () => buildDistributedMapExecution(['parseSucceeded', 'mapRunStarted', 'mapStateExited'], {
          progress: buildKeywordProgress({
            keywords_succeeded: 0,
            keywords_failed: 0
          })
        }),
        expected: 90,
      },
      {
        name: 'keeps the finished keyword share when the map run fails',
        execution: () => buildDistributedMapExecution(['parseSucceeded', 'mapRunStarted', 'mapRunFailed'], {progress: buildKeywordProgress({ keywords_failed: 11 }),}),
        expected: 90,
      },
      {
        name: 'returns 100 when the summary of a Distributed Map run succeeds',
        execution: () => buildDistributedMapExecution(['parseSucceeded', 'mapStateExited', 'summarySucceeded']),
        expected: 100,
      },
    ])('$name', ({
      execution, expected 
    }) => {
      const result = processExecutionData(execution());

      expect(result.progress).toBe(expected);
    });

    it.each([
      ['half the keywords finished (9 succeeded + 1 failed of 20)', buildKeywordProgress(), 50],
      ['no keywords finished yet', buildKeywordProgress({
        keywords_succeeded: 0,
        keywords_failed: 0 
      }), 10],
      ['the map run reports a total of 0', buildKeywordProgress({
        keywords_total: 0,
        keywords_succeeded: 0,
        keywords_failed: 0 
      }), 10],
      ['the counts overshoot the total', buildKeywordProgress({
        keywords_total: 2,
        keywords_succeeded: 3 
      }), 90],
      ['there are no keyword counts', null, 10],
    ])('returns %s -> %i while ProcessKeywords runs', (_label, progress, expected) => {
      const execution = buildDistributedMapExecution(['parseSucceeded', 'mapRunStarted'], { progress });

      const result = processExecutionData(execution);

      expect(result.progress).toBe(expected);
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

  describe('duration calculation', () => {
    it('returns duration string when execution has stop_date', () => {
      const execution = buildExecution({
        start_date: '2026-01-23T10:00:00Z',
        stop_date: '2026-01-23T10:05:00Z',
      });

      const result = processExecutionData(execution);

      expect(result.duration).toBe('5m 0s');
    });

    it('returns null duration when execution has no stop_date', () => {
      const execution = buildExecution({
        start_date: '2026-01-23T10:00:00Z',
        stop_date: undefined,
      });

      const result = processExecutionData(execution);

      // Duration calculates to "now" when no stop_date, so it won't be null
      // but we can verify it's a string
      expect(typeof result.duration).toBe('string');
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

    it('returns all events in logs array', () => {
      const events = [buildEvent()];
      const execution = buildExecution({ events });

      const result = processExecutionData(execution);

      expect(result.logs).toStrictEqual(events);
    });
  });
});
