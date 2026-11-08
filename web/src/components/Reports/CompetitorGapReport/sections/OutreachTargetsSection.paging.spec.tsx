import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { CompetitorReportResponse } from '../../../../api/reports';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../../../test/scopedTestKit';
import { OutreachTargetsSection } from './OutreachTargetsSection';
import {
  buildRollup, buildSource
} from './rollupSection-fixtures';

vi.mock('../../../../infrastructure', () => import('../../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../../test/infrastructureMock';

const OUTREACH_REQUEST = {
  path: '/reports/competitor',
  params: new URLSearchParams({
    competitor: 'Adidas',
    group_id: 'running',
  }),
};
const firstTarget = buildSource({ domain: 'runnersworld.com' });
const nextTarget = buildSource({
  domain: 'trailblog.es',
  url: 'https://trailblog.es/zapatillas',
});
const outreachAnswer: CompetitorReportResponse = {
  keywords_analyzed: 40,
  rollup: buildRollup({
    exclusive_source_count: 57,
    outreach_targets: [firstTarget],
    outreach_targets_next_token: 'outreach-2',
  }),
};
const outreachLastPage = {
  rollup: {
    outreach_targets: [nextTarget],
    outreach_targets_total: 57,
    next_token: null,
  },
};

/** Renders the outreach targets over the first page, answers the next fetch with `page` and presses load more. */
async function renderTargetsAfterLoadMore(page: unknown) {
  answerFetchesInOrder([page, 200]);
  render(
    <OutreachTargetsSection
      rollup={outreachAnswer.rollup}
      response={outreachAnswer}
      request={OUTREACH_REQUEST}
      loading={false}
      error={null}
    />,
  );
  await clickLoadMore('sources');
}

describe('OutreachTargetsSection over every exclusive source', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('counts the shown sources against every exclusive source when the answer has no outreach total', () => {
    render(
      <OutreachTargetsSection
        rollup={outreachAnswer.rollup}
        response={outreachAnswer}
        request={OUTREACH_REQUEST}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('Showing 1 of 57 sources')).toBeInTheDocument();
  });

  it('appends the next page of outreach targets', async () => {
    await renderTargetsAfterLoadMore(outreachLastPage);

    expect(await screen.findByText('trailblog.es')).toBeInTheDocument();
  });

  it('asks for the next page over view=outreach with the cursor and the scope', async () => {
    await renderTargetsAfterLoadMore(outreachLastPage);

    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('view'), searchParams.get('next_token'), searchParams.get('group_id')])
      .toStrictEqual(['outreach', 'outreach-2', 'running']);
  });
});
