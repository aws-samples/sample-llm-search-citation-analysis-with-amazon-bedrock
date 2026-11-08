import {
  describe, expect, it
} from 'vitest';
import {
  buildAuditDetail, buildIssueTypeEntry, buildIssuesResponse, buildListResponse, buildSiteAudit
} from './seoAudits-fixtures';
import {
  isAuditDetailResponse, isAuditIssueTypesResponse, isAuditIssuesResponse, isAuditListResponse, isAuditResponse
} from './seoAuditsDecoders';

describe('site audit decoders', () => {
  it('accepts a list response with audits, sites and page choices', () => {
    expect(isAuditListResponse(buildListResponse())).toBe(true);
  });

  it('rejects an audit with an unknown status', () => {
    expect(isAuditResponse({
      audit: {
        ...buildSiteAudit(),
        status: 'paused' 
      } 
    })).toBe(false);
  });

  it('accepts a running audit without summary or AI readiness', () => {
    expect(isAuditDetailResponse({
      audit: buildAuditDetail({
        status: 'running',
        summary: null,
        ai_readiness: null 
      }) 
    })).toBe(true);
  });

  it('rejects a summary missing a severity count', () => {
    const detail = buildAuditDetail();
    const summary = {
      ...detail.summary,
      counts_by_severity: {
        critical: 1,
        warning: 2 
      } 
    };

    expect(isAuditDetailResponse({
      audit: {
        ...detail,
        summary 
      } 
    })).toBe(false);
  });

  it('rejects a crawler entry with an unknown access level', () => {
    const detail = buildAuditDetail();
    const readiness = {
      ...detail.ai_readiness,
      bots: [{
        ...detail.ai_readiness?.bots[0],
        access: 'maybe' 
      }] 
    };

    expect(isAuditDetailResponse({
      audit: {
        ...detail,
        ai_readiness: readiness 
      } 
    })).toBe(false);
  });

  it('accepts issue types with their registry text', () => {
    expect(isAuditIssueTypesResponse({
      audit_id: 'a',
      issue_types: [buildIssueTypeEntry()] 
    })).toBe(true);
  });

  it('rejects an issue type with an unknown group', () => {
    expect(isAuditIssueTypesResponse({
      audit_id: 'a',
      issue_types: [{
        ...buildIssueTypeEntry(),
        group: 'misc' 
      }] 
    })).toBe(false);
  });

  it('accepts a page of affected pages with a next token', () => {
    expect(isAuditIssuesResponse(buildIssuesResponse({ next_token: 'abc' }))).toBe(true);
  });

  it('rejects affected pages whose details are not an object', () => {
    const response = buildIssuesResponse();

    expect(isAuditIssuesResponse({
      ...response,
      items: [{
        ...response.items[0],
        details: 'x' 
      }] 
    })).toBe(false);
  });
});
