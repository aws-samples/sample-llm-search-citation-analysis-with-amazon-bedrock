/**
 * Shared http/https URL policy for externally-derived URLs.
 *
 * Citation and crawler URLs are stored from AI responses and scraped pages,
 * so they are untrusted (bugs.md 2.2): a stored `javascript:` URI must never
 * become a clickable link. This module is the single protocol allowlist —
 * anchor sinks call `safeHref`, and MarkdownProcessor's DOMPurify config
 * (`ALLOWED_URI_REGEXP`) expresses the same policy for markdown-rendered
 * anchors.
 */

export const isValidHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Returns the URL when it is safe to hyperlink, `undefined` otherwise.
 *
 * With `href={safeHref(url)}`, React omits the attribute for unsafe URLs, so
 * the anchor degrades to plain text: the URL stays visible but is no longer
 * clickable or keyboard-activatable.
 */
export const safeHref = (url: string): string | undefined =>
  isValidHttpUrl(url) ? url : undefined;
