import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  cancelAudit, fetchAudit, fetchIssuePages, fetchIssueTypes, listAudits, startAudit
} from './seoAudits';
import {
  AUDIT_ID, buildAuditDetail, buildIssueTypeEntry, buildIssuesResponse, buildListResponse, buildSiteAudit
} from './seoAudits-fixtures';
import { InvalidSeoResponseError } from './seoDecoders';
import {
  seoGet, seoPost
} from './seoRequest';

vi.mock('./seoRequest', () => ({
  seoGet: vi.fn(),
  seoPost: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(seoGet).mockResolvedValue(buildListResponse());
  vi.mocked(seoPost).mockResolvedValue({ audit: buildSiteAudit() });
});

describe('site audit client', () => {
  it('lists audits from /audits', async () => {
    await listAudits();

    expect(seoGet).toHaveBeenCalledWith('/audits', {}, {});
  });

  it('reads one audit from /audits/{id}', async () => {
    vi.mocked(seoGet).mockResolvedValue({ audit: buildAuditDetail() });

    await expect(fetchAudit(AUDIT_ID)).resolves.toStrictEqual({ audit: buildAuditDetail() });
  });

  it('starts an audit with its site and page limit', async () => {
    await startAudit({
      start_url: 'example.com',
      max_pages: 100 
    });

    expect(seoPost).toHaveBeenCalledWith('/audits', {
      start_url: 'example.com',
      max_pages: 100 
    }, {});
  });

  it('cancels through /audits/{id}/cancel', async () => {
    await cancelAudit(AUDIT_ID);

    expect(seoPost).toHaveBeenCalledWith(`/audits/${AUDIT_ID}/cancel`, {}, {});
  });

  it('reads the issue types without an issue_type parameter', async () => {
    vi.mocked(seoGet).mockResolvedValue({
      audit_id: AUDIT_ID,
      issue_types: [buildIssueTypeEntry()] 
    });
    await fetchIssueTypes(AUDIT_ID);

    expect(seoGet).toHaveBeenCalledWith(`/audits/${AUDIT_ID}/issues`, {}, {});
  });

  it('reads affected pages with the issue type and the paging token', async () => {
    vi.mocked(seoGet).mockResolvedValue(buildIssuesResponse());
    await fetchIssuePages(AUDIT_ID, 'missing-title', 'tok');

    expect(seoGet).toHaveBeenCalledWith(`/audits/${AUDIT_ID}/issues`, {
      issue_type: 'missing-title',
      next_token: 'tok' 
    }, {});
  });

  it('throws InvalidSeoResponseError when the answer does not decode', async () => {
    vi.mocked(seoGet).mockResolvedValue({ audits: 'nope' });

    await expect(listAudits()).rejects.toThrow(InvalidSeoResponseError);
    await expect(listAudits()).rejects.toThrow('SEO API returned an invalid audit list');
  });
});
