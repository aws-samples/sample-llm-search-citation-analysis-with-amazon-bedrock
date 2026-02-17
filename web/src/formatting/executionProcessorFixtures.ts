import type {
  Execution, ExecutionEvent 
} from '../types';

const EVENT_DEFAULTS: ExecutionEvent = {
  id: 'event-1',
  timestamp: '2026-01-23T10:00:00Z',
  type: 'TaskStarted',
  state_name: 'ParseKeywords',
};

const createEventIdGenerator = () => {
  const state = { counter: 0 };
  return () => {
    state.counter += 1;
    return `event-${state.counter}`;
  };
};

const generateEventId = createEventIdGenerator();

export function buildEvent(overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    ...EVENT_DEFAULTS,
    ...overrides,
    id: overrides.id ?? generateEventId() 
  };
}

export function buildExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    arn: 'arn:aws:states:us-east-1:123:execution:test',
    name: 'test-execution',
    status: 'RUNNING',
    start_date: '2026-01-23T10:00:00Z',
    events: [],
    ...overrides,
  };
}

export function buildCompletedExecution(): Execution {
  return buildExecution({
    status: 'SUCCEEDED',
    stop_date: '2026-01-23T10:05:00Z',
    events: [
      buildEvent({
        type: 'TaskStarted',
        state_name: 'ParseKeywords',
        timestamp: '2026-01-23T10:00:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'ParseKeywords',
        timestamp: '2026-01-23T10:01:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'SearchAllProviders',
        timestamp: '2026-01-23T10:01:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'SearchAllProviders',
        timestamp: '2026-01-23T10:02:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'Deduplication',
        timestamp: '2026-01-23T10:02:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'Deduplication',
        timestamp: '2026-01-23T10:03:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'Crawl',
        timestamp: '2026-01-23T10:03:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'Crawl',
        timestamp: '2026-01-23T10:04:00Z' 
      }),
      buildEvent({
        type: 'TaskStarted',
        state_name: 'GenerateSummary',
        timestamp: '2026-01-23T10:04:00Z' 
      }),
      buildEvent({
        type: 'TaskSucceeded',
        state_name: 'GenerateSummary',
        timestamp: '2026-01-23T10:05:00Z' 
      }),
    ],
  });
}
