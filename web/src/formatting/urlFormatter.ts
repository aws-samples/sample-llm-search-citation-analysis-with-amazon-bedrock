/**
 * URL display formatting.
 *
 * `getDomain` previously existed twice (bugs.md 4.4): module-private in
 * `exporters/citationParser.ts` and inline in `CitationsView`, prop-drilled
 * through every `CitationRow`. Display-only — the http/https safety policy
 * for hyperlinks lives in `infrastructure/urlSafety`.
 */
export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
