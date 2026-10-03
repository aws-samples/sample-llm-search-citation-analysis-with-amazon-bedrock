import {
  createResearchTemplate,
  deleteResearchTemplate,
  fetchResearchTemplates,
  updateResearchTemplate,
} from '../api/keywordResearch';
import type {
  TemplateChanges, TemplateDraft
} from '../api/keywordResearch';
import type { ResearchTemplate } from '../types';
import {
  compareTemplateNames, useSavedTemplates
} from './useSavedTemplates';
import type {
  SavedTemplateOutcome, SavedTemplatesReturn, SavedTemplatesSource
} from './useSavedTemplates';

export type TemplateMutationOutcome = SavedTemplateOutcome<ResearchTemplate>;

/**
 * Built-ins first, as the API lists them (hotels, restaurants, …), then the
 * saved templates by name. The API itself refuses edits to built-ins.
 */
const RESEARCH_TEMPLATES: SavedTemplatesSource<ResearchTemplate, TemplateDraft, TemplateChanges> = {
  errorScope: 'research',
  logTag: '[research]',
  subject: 'template',
  list: () => fetchResearchTemplates(),
  create: createResearchTemplate,
  update: updateResearchTemplate,
  remove: deleteResearchTemplate,
  compareSaved: compareTemplateNames,
  guardBuiltins: false,
};

/**
 * The research agent's templates (industry profiles): the built-ins plus the
 * ones the team saved. Mutations update the list in place (the API answers
 * with the saved row) so the editor never shows a stale template.
 */
export const useResearchTemplates = (): SavedTemplatesReturn<ResearchTemplate, TemplateDraft, TemplateChanges> => (
  useSavedTemplates(RESEARCH_TEMPLATES)
);
