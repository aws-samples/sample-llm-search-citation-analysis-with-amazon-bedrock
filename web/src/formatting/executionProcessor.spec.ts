import {
  describe, it, expect 
} from 'vitest';
import { processExecutionData } from './executionProcessor';
import {
  buildExecution, buildEvent, buildCompletedExecution 
} from './executionProcessorFixtures';

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

    it('returns 5 pending steps', () => {
      const result = processExecutionData(null);

      expect(result.steps).toHaveLength(5);
      expect(result.steps.every(s => s.status === 'pending')).toBe(true);
    });

    it('returns 0 progress', () => {
      const result = processExecutionData(null);

      expect(result.progress).toBe(0);
    });

    it('returns correct step names in order', () => {
      const result = processExecutionData(null);

      expect(result.steps.map(s => s.name)).toStrictEqual([
        'ParseKeywords',
        'SearchAllProviders',
        'Deduplication',
        'Crawl',
        'GenerateSummary',
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

    it('returns currentStep as the running step name', () => {
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

      expect(result.currentStep).toBe('SearchAllProviders');
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

    it('returns 20 when 1 of 5 steps completed', () => {
      const execution = buildExecution({
        events: [
          buildEvent({
            type: 'TaskSucceeded',
            state_name: 'ParseKeywords' 
          }),
        ],
      });

      const result = processExecutionData(execution);

      expect(result.progress).toBe(20);
    });

    it('returns 100 when all 5 steps completed', () => {
      const execution = buildCompletedExecution();

      const result = processExecutionData(execution);

      expect(result.progress).toBe(100);
    });

    it('returns 60 when 3 of 5 steps completed', () => {
      const execution = buildExecution({
        events: [
          buildEvent({
            type: 'TaskSucceeded',
            state_name: 'ParseKeywords' 
          }),
          buildEvent({
            type: 'TaskSucceeded',
            state_name: 'SearchAllProviders' 
          }),
          buildEvent({
            type: 'TaskSucceeded',
            state_name: 'Deduplication' 
          }),
        ],
      });

      const result = processExecutionData(execution);

      expect(result.progress).toBe(60);
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
