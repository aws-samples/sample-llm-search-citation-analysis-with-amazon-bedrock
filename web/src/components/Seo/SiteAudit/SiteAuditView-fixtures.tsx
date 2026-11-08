import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import {
  fetchAudit, fetchIssuePages, fetchIssueTypes, listAudits
} from '../../../api/seoAudits';
import {
  AUDIT_ID, PAGE_URL, buildAuditDetail, buildIssueTypeEntry, buildIssuesResponse, buildListResponse
} from '../../../api/seoAudits-fixtures';
import { mockAdminRole } from '../../../test/useIsAdminMock';
import type { SiteAuditDetail } from '../../../types/api/seoAudits';
import { MemoryRouter } from 'react-router-dom';
import { SiteAuditView } from './SiteAuditView';

/** The issue types the completed audit answers: a critical content issue and an AI-readiness notice. */
const ISSUE_TYPES = [
  buildIssueTypeEntry(),
  buildIssueTypeEntry({
    issue_type: 'llms-txt-missing',
    severity: 'info',
    group: 'ai_readiness',
    title: 'No llms.txt',
  }),
];

/**
 * The view with a completed audit, its issue types and one affected page; `admin` decides the Admin UI and
 * `sites` the owned domains of Settings › Brand Tracking the server offers.
 */
export function setupSiteAudit({
  admin = true, detail = buildAuditDetail(), sites = ['example.com']
}: {
  admin?: boolean;
  detail?: SiteAuditDetail;
  sites?: string[];
} = {}) {
  mockAdminRole(admin);
  vi.mocked(listAudits).mockResolvedValue(buildListResponse({ sites }));
  vi.mocked(fetchAudit).mockResolvedValue({ audit: detail });
  vi.mocked(fetchIssueTypes).mockResolvedValue({
    audit_id: AUDIT_ID,
    issue_types: ISSUE_TYPES,
  });
  vi.mocked(fetchIssuePages).mockResolvedValue(buildIssuesResponse());
}

export function renderSiteAudit() {
  const user = userEvent.setup();
  return {
    user,
    ...render(<SiteAuditView />, { wrapper: MemoryRouter }),
  };
}

/** Renders the view, opens the affected pages of "Missing title tag" and waits for its first page. */
export async function openAffectedPages() {
  const { user } = renderSiteAudit();
  await user.click(await screen.findByRole('button', { name: 'View pages: Missing title tag' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('link', { name: PAGE_URL });
  return {
    user,
    dialog,
  };
}
