import {
  describe, it, expect 
} from 'vitest';
import {
  formatResearchFailureMessage,
  getResearchStatusClass,
  getResearchStatusLabel,
  resolveResearchStatus
} from './researchStatus';

describe('resolveResearchStatus', () => {
  it('returns null when a legacy row carries no status', () => {
    expect(resolveResearchStatus(undefined)).toBeNull();
  });

  it('returns null when the status is not one the UI knows', () => {
    expect(resolveResearchStatus('archived')).toBeNull();
  });

  it('returns "failed" for a row the backend marked failed', () => {
    expect(resolveResearchStatus('failed')).toBe('failed');
  });

  it('returns "processing" for a run still in flight', () => {
    expect(resolveResearchStatus('processing')).toBe('processing');
  });
});

describe('getResearchStatusLabel', () => {
  it('labels a failed run "Failed"', () => {
    expect(getResearchStatusLabel('failed')).toBe('Failed');
  });

  it('labels a pending run "Queued"', () => {
    expect(getResearchStatusLabel('pending')).toBe('Queued');
  });

  it('labels a processing run "Running"', () => {
    expect(getResearchStatusLabel('processing')).toBe('Running');
  });

  it('labels a completed run "Completed"', () => {
    expect(getResearchStatusLabel('completed')).toBe('Completed');
  });
});

describe('getResearchStatusClass', () => {
  it('styles a failed run in red', () => {
    expect(getResearchStatusClass('failed')).toBe('bg-red-100 text-red-700');
  });

  it('styles a completed run in emerald', () => {
    expect(getResearchStatusClass('completed')).toBe('bg-emerald-100 text-emerald-700');
  });
});

describe('formatResearchFailureMessage', () => {
  it('rewrites the stranded production message to days', () => {
    expect(formatResearchFailureMessage('Research timed out after 4434821 seconds. Please try again.'))
      .toBe('Research timed out after 51 days. Please try again.');
  });

  it('rewrites a short timeout to minutes', () => {
    expect(formatResearchFailureMessage('Research timed out after 300 seconds. Please try again.'))
      .toBe('Research timed out after 5 minutes. Please try again.');
  });

  it('leaves a message without an embedded second count untouched', () => {
    expect(formatResearchFailureMessage('Provider rejected the request')).toBe('Provider rejected the request');
  });

  it('rewrites every embedded second count in the message', () => {
    expect(formatResearchFailureMessage('Waited 60 seconds, retried, waited 7200 seconds'))
      .toBe('Waited 1 minute, retried, waited 2 hours');
  });

  it('leaves a bare number that is not a second count untouched', () => {
    expect(formatResearchFailureMessage('Attempt 3 failed')).toBe('Attempt 3 failed');
  });
});
