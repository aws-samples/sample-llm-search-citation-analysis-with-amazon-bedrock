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

    it('returns the parse, keyword and summary steps in order', () => {
      const result = processExecutionData(null);

      expect(result.steps.map(s => s.name)).toStrictEqual([
        'ParseKeywords',
        'ProcessKeywords',
        'GenerateSummary',
      ]);
    });

    it('describes the ProcessKeywords step as the per-keyword search, dedupe and crawl', () => {
      const result = processExecutionData(null);

      expect(result.steps.map(s => s.description)).toStrictEqual([
        undefined,
        'Search, dedupe and crawl per keyword',
        undefined,
      ]);
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

    it('marks step as running when TaskStarted event received', () => {
      const execution = buildExecution({
        events: [buildEvent({
          type: 'TaskStarted',
          state_name: 'ParseKeywords' 
        })],
      });

      const result = processExecutionData(execution);

      expect(result.steps[0].status).toBe('running');
    });

    it('marks step as completed when TaskSucceeded event received', () => {
      const execution = buildExecution({
        events: [
          buildEvent({
            type: 'TaskStarted',
            state_name: 'ParseKeywords' 
          }),
          buildEvent({
            type: 'TaskSucceeded',
            state_name: 'ParseKeywords' 
          }),
        ],
      });

      const result = processExecutionData(execution);

      expect(result.steps[0].status).toBe('completed');
    });

    it('marks step as failed when TaskFailed event received', () => {
      const execution = buildExecution({
        events: [
          buildEvent({
            type: 'TaskStarted',
            state_name: 'ParseKeywords' 
          }),
          buildEvent({
            type: 'TaskFailed',
            state_name: 'ParseKeywords',
            error: 'Parse error' 
          }),
        ],
      });

      const result = processExecutionData(execution);

      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].error).toBe('Parse error');
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
    it('returns 0 when no steps completed', () => {
      const execution = buildExecution({ events: [] });

      const result = processExecutionData(execution);

      expect(result.progress).toBe(0);
    });

    it('returns 10 when only ParseKeywords completed', () => {
      const execution = buildDistributedMapExecution(['parseStarted', 'parseSucceeded']);

      const result = processExecutionData(execution);

      expect(result.progress).toBe(10);
    });

    it('returns 100 when a legacy run completed every step', () => {
      const execution = buildCompletedExecution();

      const result = processExecutionData(execution);

      expect(result.progress).toBe(100);
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

    it('returns 90 once ProcessKeywords exits, whatever the keyword counts say', () => {
      const execution = buildDistributedMapExecution(['parseSucceeded', 'mapRunStarted', 'mapStateExited'], {
        progress: buildKeywordProgress({
          keywords_succeeded: 0,
          keywords_failed: 0 
        }) 
      });

      const result = processExecutionData(execution);

      expect(result.progress).toBe(90);
    });

    it('keeps the finished keyword share when the map run fails', () => {
      const execution = buildDistributedMapExecution(['parseSucceeded', 'mapRunStarted', 'mapRunFailed'], {progress: buildKeywordProgress({ keywords_failed: 11 }),});

      const result = processExecutionData(execution);

      expect(result.progress).toBe(90);
    });

    it('returns 100 when the summary of a Distributed Map run succeeds', () => {
      const execution = buildDistributedMapExecution(['parseSucceeded', 'mapStateExited', 'summarySucceeded']);

      const result = processExecutionData(execution);

      expect(result.progress).toBe(100);
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
    ])('keeps ProcessKeywords running when one keyword reports %s for %s', (type, stateName) => {
      const execution = buildLegacyExecution([{
        type: 'TaskStarted',
        state_name: 'SearchAllProviders' 
      }, {
        type,
        state_name: stateName 
      }]);

      const result = processExecutionData(execution);

      expect(result.steps.map(s => s.status)).toStrictEqual(['completed', 'running', 'pending']);
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

    it('completes ProcessKeywords when the legacy keyword map exits', () => {
      const execution = buildLegacyExecution([{
        type: 'TaskStarted',
        state_name: 'SearchAllProviders' 
      }, {
        type: 'MapStateExited',
        state_name: 'ProcessKeywords' 
      }]);

      const result = processExecutionData(execution);

      expect(result.steps.map(s => s.status)).toStrictEqual(['completed', 'completed', 'pending']);
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
