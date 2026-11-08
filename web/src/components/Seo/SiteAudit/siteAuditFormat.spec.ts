import {
  describe, expect, it
} from 'vitest';
import { issueDetailText } from './siteAuditFormat';

describe('issueDetailText', () => {
  it('reads details as key value pairs with lists joined by commas', () => {
    expect(issueDetailText({
      status_code: 404,
      linked_from: ['https://www.example.com/', 'https://www.example.com/deals'],
    })).toBe('status code: 404 · linked from: https://www.example.com/, https://www.example.com/deals');
  });

  it('is empty when the issue has no details', () => {
    expect(issueDetailText({})).toBe('');
  });
});
