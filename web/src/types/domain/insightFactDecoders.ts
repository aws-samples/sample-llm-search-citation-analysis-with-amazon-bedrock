/**
 * Runtime guards for the Phase 2 facts of `GET /reports/insights`
 * (`./insights`): positions per keyword and engine, citation ownership,
 * owned pages and competitor caveats. `./insightsDecoders` assembles them
 * with the rest of the payload.
 */
import { isStringArray } from '../../api/contentStudioDecoderPrimitives';
import type {
  CitationOwnershipFacts, CitationOwnershipRow, CompetitorCaveatRow, OwnedPageRow, OwnedPagesEngineRow, OwnedPagesFacts, OwnedSectionRow,
  PromptEngineFacts, PromptEngineRow
} from './insights';
import { isRecord } from './keywordDecoders';

export function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

/** An object whose every value passes `isValue`. */
function isRecordOf(value: unknown, isValue: (item: unknown) => boolean): boolean {
  return isRecord(value) && Object.values(value).every(isValue);
}

function isListOf(value: unknown, isItem: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(isItem);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isPromptEngineRow(value: unknown): value is PromptEngineRow {
  return isRecord(value)
    && typeof value.keyword === 'string'
    && isNullableNumber(value.visibility_score)
    && isRecordOf(value.positions, isNullableNumber)
    && isStringArray(value.lost_engines);
}

export function isPromptEngineFacts(value: unknown): value is PromptEngineFacts {
  return isRecord(value)
    && isStringArray(value.engines)
    && isListOf(value.keywords, isPromptEngineRow)
    && isNumber(value.omitted);
}

function isCitationOwnershipRow(value: unknown): value is CitationOwnershipRow {
  return isRecord(value)
    && typeof value.engine === 'string'
    && isNumber(value.answers)
    && isNumber(value.citations)
    && isNumber(value.owned)
    && isRecordOf(value.competitors, isNumber)
    && isNumber(value.third_party);
}

export function isCitationOwnershipFacts(value: unknown): value is CitationOwnershipFacts {
  return isRecord(value)
    && typeof value.owned_configured === 'boolean'
    && typeof value.competitors_configured === 'boolean'
    && isListOf(value.engines, isCitationOwnershipRow);
}

function isOwnedPageRow(value: unknown): value is OwnedPageRow {
  return isRecord(value)
    && typeof value.url === 'string'
    && typeof value.section === 'string'
    && typeof value.is_document === 'boolean'
    && isNumber(value.citations)
    && isStringArray(value.engines);
}

function isOwnedSectionRow(value: unknown): value is OwnedSectionRow {
  return isRecord(value)
    && typeof value.section === 'string'
    && isNumber(value.citations)
    && isNumber(value.document_citations)
    && isNumber(value.pages);
}

/** The document and web-page citation counts of an engine row or of the totals. */
function hasCitationSplit(value: Record<string, unknown>): boolean {
  return isNumber(value.document_citations) && isNumber(value.page_citations);
}

function isOwnedPagesEngineRow(value: unknown): value is OwnedPagesEngineRow {
  return isRecord(value) && typeof value.engine === 'string' && hasCitationSplit(value);
}

export function isOwnedPagesFacts(value: unknown): value is OwnedPagesFacts {
  return isRecord(value)
    && isListOf(value.pages, isOwnedPageRow)
    && isNumber(value.pages_omitted)
    && isListOf(value.sections, isOwnedSectionRow)
    && isListOf(value.engines, isOwnedPagesEngineRow)
    && hasCitationSplit(value);
}

export function isCompetitorCaveatRow(value: unknown): value is CompetitorCaveatRow {
  return isRecord(value)
    && typeof value.name === 'string'
    && isNumber(value.mentions)
    && isNumber(value.mixed)
    && isNumber(value.negative)
    && isNullableNumber(value.caveat_share)
    && isStringArray(value.reasons);
}
