/**
 * Keyword identity: the frontend half of the cross-runtime keyword-identity
 * contract (trim → NFKC → lowercase), mirrored by
 * `lambda/shared/utils.py::normalize_keyword` and locked on both sides by
 * the shared fixture `test-fixtures/keyword-identity.json`.
 *
 * Extracted from `usePromoteKeywords.ts` (bugs.md 4.3) — the cluster is
 * consumed by selection UIs well beyond the promotion hook.
 */
import type { ResearchKeyword } from '../types';

function isKeywordBoundaryCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0009 && codePoint <= 0x000D)
    || codePoint === 0x0020
    || codePoint === 0x0085
    || codePoint === 0x00A0
    || codePoint === 0x1680
    || (codePoint >= 0x2000 && codePoint <= 0x200A)
    || codePoint === 0x2028
    || codePoint === 0x2029
    || codePoint === 0x202F
    || codePoint === 0x205F
    || codePoint === 0x3000
    || codePoint === 0xFEFF
  );
}

function isKeywordBoundaryCharacter(character: string): boolean {
  return isKeywordBoundaryCodePoint(character.codePointAt(0) ?? -1);
}

function isUnicodeScalarText(text: string): boolean {
  return Array.from(text).every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && !(codePoint >= 0xD800 && codePoint <= 0xDFFF);
  });
}

function trimKeywordText(text: string): string {
  const characters = Array.from(text);
  const start = characters.findIndex((character) => !isKeywordBoundaryCharacter(character));
  if (start === -1) return '';

  const trailingCount = [...characters]
    .reverse()
    .findIndex((character) => !isKeywordBoundaryCharacter(character));
  const end = characters.length - trailingCount;
  return characters.slice(start, end).join('');
}

// Known accepted limitation: NFKC and lowercase use the browser's Unicode
// tables, which can be newer than the backend runtime's tables for recently
// assigned code points.
export function keywordSelectionKey(keyword: string): string {
  if (!isUnicodeScalarText(keyword)) return '';
  return trimKeywordText(keyword.normalize('NFKC')).toLowerCase();
}

export function uniqueResearchKeywords<T extends ResearchKeyword>(keywords: readonly T[]): T[] {
  const seen = new Set<string>();
  return keywords.filter((keyword) => {
    const key = keywordSelectionKey(keyword.keyword);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
