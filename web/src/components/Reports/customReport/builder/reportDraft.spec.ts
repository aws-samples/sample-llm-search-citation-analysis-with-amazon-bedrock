import {
  describe, expect, it
} from 'vitest';
import { ApiRequestError } from '../../../../infrastructure';
import { keyedBlocks } from '../blockOrder';
import {
  buildHeadingBlock, buildImageBlock
} from '../customReport-fixtures';
import {
  draftInput, draftProblem, saveFailureMessage
} from './reportDraft';
import type { ReportDraft } from './useReportDraft';

const DRAFT: ReportDraft = {
  title: 'Board pack',
  days: 90,
  items: keyedBlocks([{ type: 'sources_headline' }, buildHeadingBlock({ text: 'Where we stand' })]),
};

describe('draftProblem', () => {
  it('accepts a named draft with valid blocks', () => {
    expect(draftProblem(DRAFT)).toBeNull();
  });

  it('asks for a name when the title is blank', () => {
    expect(draftProblem({
      ...DRAFT,
      title: '   ',
    })).toBe('Give the report a name.');
  });

  it('asks for a block when the draft is empty', () => {
    expect(draftProblem({
      ...DRAFT,
      items: [],
    })).toBe('Add at least one block.');
  });

  it('refuses more blocks than a report holds', () => {
    const items = keyedBlocks(Array.from({ length: 31 }, () => buildHeadingBlock()));

    expect(draftProblem({
      ...DRAFT,
      items,
    })).toBe('A report holds at most 30 blocks.');
  });

  it('names the position and kind of the first content block to fix', () => {
    const items = keyedBlocks([{ type: 'sources_headline' }, buildImageBlock({ alt: '' })]);

    expect(draftProblem({
      ...DRAFT,
      items,
    })).toBe('Block 2 (Image): Describe the image for people who cannot see it.');
  });
});

describe('draftInput', () => {
  it('sends the trimmed title, the period and each block as the server stores it', () => {
    const items = keyedBlocks([
      {
        type: 'sources_headline',
        stale: true,
      },
      buildHeadingBlock({ text: '  Where we stand  ' }),
    ]);

    expect(draftInput({
      title: '  Board pack ',
      days: 30,
      items,
    })).toStrictEqual({
      title: 'Board pack',
      blocks: [
        { type: 'sources_headline' },
        {
          type: 'heading',
          text: 'Where we stand',
          level: 2,
        },
      ],
      days: 30,
    });
  });
});

describe('saveFailureMessage', () => {
  it('explains the saved-report limit on a 409', () => {
    expect(saveFailureMessage(new ApiRequestError('limit_reached', {
      statusCode: 409,
      responseMessage: 'limit_reached',
      field: 'reports',
    }))).toBe('There are already 50 saved reports. Delete one to save another.');
  });

  it('suggests saving a copy when the report was deleted meanwhile', () => {
    expect(saveFailureMessage(new ApiRequestError('Custom report not found', 404)))
      .toBe('This report was deleted in the meantime. Use Save as new report to keep your changes.');
  });

  it('shows the server\u2019s reason for any other refusal', () => {
    expect(saveFailureMessage(new ApiRequestError('Block 3: image url must be an https link', {
      statusCode: 400,
      responseMessage: 'Block 3: image url must be an https link',
      field: 'blocks',
    }))).toBe('Block 3: image url must be an https link');
  });
});
