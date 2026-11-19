import {
  describe, expect, it
} from 'vitest';
import {
  RUNNING_JOB, buildReextractEstimate, buildReextractJob, withoutField
} from './reextract-fixtures';
import {
  isReextractEstimate, isReextractFilters, isReextractJob, isReextractJobEnvelope, isReextractStatus
} from './reextractDecoders';

describe('isReextractEstimate', () => {
  it('accepts an estimate with every field well-typed', () => {
    expect(isReextractEstimate(buildReextractEstimate())).toBe(true);
  });

  it('rejects an estimate whose answer count is negative', () => {
    expect(isReextractEstimate(buildReextractEstimate({ answers: -1 }))).toBe(false);
  });

  it('rejects an estimate without the truncated flag', () => {
    expect(isReextractEstimate(withoutField(buildReextractEstimate(), 'truncated'))).toBe(false);
  });

  it('rejects an estimate whose cost is a string', () => {
    expect(isReextractEstimate({
      ...buildReextractEstimate(),
      estimated_cost_usd: '3.42',
    })).toBe(false);
  });
});

describe('isReextractFilters', () => {
  it('accepts filters with every field absent', () => {
    expect(isReextractFilters({})).toBe(true);
  });

  it('rejects filters whose group ids are not all strings', () => {
    expect(isReextractFilters({ group_ids: ['group-costamar', 7] })).toBe(false);
  });

  it('rejects filters whose only_outdated is not a boolean', () => {
    expect(isReextractFilters({ only_outdated: 'yes' })).toBe(false);
  });
});

describe('isReextractJob', () => {
  it('accepts a running job', () => {
    expect(isReextractJob(RUNNING_JOB)).toBe(true);
  });

  it('rejects a job with an unknown status', () => {
    expect(isReextractJob({
      ...RUNNING_JOB,
      status: 'paused',
    })).toBe(false);
  });

  it('rejects a job without finished_at', () => {
    expect(isReextractJob(withoutField(RUNNING_JOB, 'finished_at'))).toBe(false);
  });

  it('rejects a job whose failed count is a fraction', () => {
    expect(isReextractJob(buildReextractJob({ answers_failed: 1.5 }))).toBe(false);
  });
});

describe('isReextractStatus', () => {
  it('accepts a status without a job', () => {
    expect(isReextractStatus({
      job: null,
      active: false,
    })).toBe(true);
  });

  it('accepts a status with an active job', () => {
    expect(isReextractStatus({
      job: RUNNING_JOB,
      active: true,
    })).toBe(true);
  });

  it('rejects a status without the active flag', () => {
    expect(isReextractStatus({ job: null })).toBe(false);
  });

  it('rejects a status whose job is malformed', () => {
    expect(isReextractStatus({
      job: { job_id: 'rx-1a2b' },
      active: true,
    })).toBe(false);
  });
});

describe('isReextractJobEnvelope', () => {
  it('accepts a job inside a job field', () => {
    expect(isReextractJobEnvelope({ job: RUNNING_JOB })).toBe(true);
  });

  it('rejects a bare job', () => {
    expect(isReextractJobEnvelope(RUNNING_JOB)).toBe(false);
  });
});
