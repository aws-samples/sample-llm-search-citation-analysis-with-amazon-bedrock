import {
  describe, expect, it 
} from 'vitest';

import {
  isValidHttpUrl, safeHref 
} from './urlSafety';

describe('isValidHttpUrl', () => {
  it('accepts an https URL', () => {
    expect(isValidHttpUrl('https://example.com/page?q=1')).toBe(true);
  });

  it('accepts an http URL', () => {
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects a javascript URI', () => {
    expect(isValidHttpUrl('javascript:alert(document.cookie)')).toBe(false);
  });

  it('rejects a javascript URI with mixed-case scheme', () => {
    expect(isValidHttpUrl('JaVaScRiPt:alert(1)')).toBe(false);
  });

  it('rejects a data URI', () => {
    expect(isValidHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects a vbscript URI', () => {
    expect(isValidHttpUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects a relative path because it has no protocol', () => {
    expect(isValidHttpUrl('/internal/path')).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(isValidHttpUrl('//evil.example.com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidHttpUrl('')).toBe(false);
  });
});

describe('safeHref', () => {
  it('returns the URL unchanged when it is http(s)', () => {
    expect(safeHref('https://example.com/article')).toBe('https://example.com/article');
  });

  it('returns undefined when the URL is a javascript URI', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
  });

  it('returns undefined when the URL is unparseable', () => {
    expect(safeHref('not a url at all')).toBeUndefined();
  });
});
