import {
  describe, expect, it
} from 'vitest';
import {
  isBacklinkSnapshotsResponse, isBacklinksOverviewResponse, isBacklinksTableResponse
} from './seoBacklinksDecoders';
import { withoutField } from './seo-fixtures';
import {
  BACKLINKS_EXPORT, buildBacklinkRow, buildOverview, buildReferringDomainRow, buildSnapshots, buildTablePage, buildTopPageRow,
  buildTrackedDomain
} from './seoBacklinks-fixtures';

describe('isBacklinksOverviewResponse', () => {
  it('accepts an overview whose summary is null (no data)', () => {
    expect(isBacklinksOverviewResponse(buildOverview({ summary: null }))).toBe(true);
  });

  it('accepts the two-field summary of a subfolder', () => {
    expect(isBacklinksOverviewResponse(buildOverview({
      scope: 'subfolder',
      summary: {
        backlinks: 900,
        referring_domains: 70,
      },
    }))).toBe(true);
  });

  it('rejects an overview with an unknown scope', () => {
    expect(isBacklinksOverviewResponse({
      ...buildOverview(),
      scope: 'folder',
    })).toBe(false);
  });

  it('rejects a summary metric that is not a finite number', () => {
    expect(isBacklinksOverviewResponse(buildOverview({ summary: { rank: Number.NaN } }))).toBe(false);
  });
});

describe('isBacklinksTableResponse', () => {
  it('accepts a backlinks page with an unknown spam score', () => {
    const page = buildTablePage('backlinks', [buildBacklinkRow({ spam_score: null })]);

    expect(isBacklinksTableResponse('backlinks')(page)).toBe(true);
  });

  it('accepts referring domain and top page rows', () => {
    const domains = buildTablePage('referring_domains', [buildReferringDomainRow()]);
    const pages = buildTablePage('top_pages', [buildTopPageRow({ page: null })]);

    expect([isBacklinksTableResponse('referring_domains')(domains), isBacklinksTableResponse('top_pages')(pages)])
      .toStrictEqual([true, true]);
  });

  it('rejects a backlink row without its lost flag', () => {
    const page = {
      ...buildTablePage('backlinks', []),
      rows: [withoutField(buildBacklinkRow(), 'is_lost')],
    };

    expect(isBacklinksTableResponse('backlinks')(page)).toBe(false);
  });

  it('rejects a page without has_more', () => {
    expect(isBacklinksTableResponse('top_pages')(withoutField(buildTablePage('top_pages', []), 'has_more'))).toBe(false);
  });

  it('accepts an export chunk that echoes its offset and limit', () => {
    const chunk = buildTablePage('referring_domains', [], {
      offset: 1000,
      limit: 500,
    });

    expect(isBacklinksTableResponse('referring_domains')(chunk)).toBe(true);
  });

  it('rejects a page without the export pricing', () => {
    expect(isBacklinksTableResponse('backlinks')(withoutField(buildTablePage('backlinks', []), 'export'))).toBe(false);
  });

  it('rejects export pricing whose row price is missing', () => {
    const page = {
      ...buildTablePage('top_pages', []),
      export: withoutField(BACKLINKS_EXPORT, 'row_usd'),
    };

    expect(isBacklinksTableResponse('top_pages')(page)).toBe(false);
  });
});

describe('isBacklinkSnapshotsResponse', () => {
  it('accepts tracked domains with their snapshots', () => {
    expect(isBacklinkSnapshotsResponse(buildSnapshots())).toBe(true);
  });

  it('rejects a tracked domain with an unknown role', () => {
    const payload = {
      ...buildSnapshots(),
      domains: [{
        ...buildTrackedDomain(),
        role: 'partner',
      }],
    };

    expect(isBacklinkSnapshotsResponse(payload)).toBe(false);
  });
});
