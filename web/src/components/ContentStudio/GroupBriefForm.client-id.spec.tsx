import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import type { GroupBriefIdea } from '../../types';
import * as groupBriefSource from './GroupBriefForm-source';
import {
  prepareGroupBriefClientIdMocks, submitGroupBriefTwice
} from './GroupBriefForm-client-id-fixtures';
import {
  renderGroupBriefForm, selectGroupForBrief, submitGroupBrief
} from './GroupBriefForm-fixtures';

vi.mock('../../hooks/useKeywordGroups');
vi.mock('../../hooks/useContentBriefTemplates');

const repeatedSubmissionCases = [
  {
    testName: 'reuses the same client ID when a failed request is retried later',
    outcomes: [false, true],
    expectedIds: ['brief-before-boundary', 'brief-before-boundary'],
  },
  {
    testName: 'uses a new client ID for the deliberate submission after acceptance',
    outcomes: [true, true],
    expectedIds: ['brief-before-boundary', 'brief-after-boundary'],
  },
];

beforeEach(prepareGroupBriefClientIdMocks);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GroupBriefForm client request IDs', () => {
  it.each(repeatedSubmissionCases)('$testName', async ({
    outcomes,
    expectedIds,
  }) => {
    vi.spyOn(groupBriefSource, 'createGroupBriefIdeaId')
      .mockReturnValueOnce('brief-before-boundary')
      .mockReturnValue('brief-after-boundary');
    const onGenerate = vi.fn<(idea: GroupBriefIdea) => Promise<boolean>>()
      .mockResolvedValueOnce(outcomes[0] ?? false)
      .mockResolvedValueOnce(outcomes[1] ?? false);

    await submitGroupBriefTwice(onGenerate);

    expect(onGenerate.mock.calls.map(([idea]) => idea.id)).toStrictEqual(expectedIds);
  });

  it('closes the confirmation after a failed request settles', async () => {
    const onGenerate = vi.fn<(idea: GroupBriefIdea) => Promise<boolean>>()
      .mockResolvedValue(false);
    renderGroupBriefForm({ onGenerate });
    await selectGroupForBrief();

    await submitGroupBrief();

    expect(screen.queryByRole('button', { name: 'Start 1 job' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review generation' })).toBeEnabled();
  });
});
