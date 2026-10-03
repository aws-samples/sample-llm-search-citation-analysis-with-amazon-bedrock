import {
  createContentBriefTemplate,
  deleteContentBriefTemplate,
  fetchContentBriefTemplates,
  updateContentBriefTemplate,
} from '../api/contentStudio';
import type {
  ContentBriefTemplate,
  ContentBriefTemplateChanges,
  ContentBriefTemplateDraft,
} from '../types';
import {
  compareTemplateNames, useSavedTemplates
} from './useSavedTemplates';
import type {
  SavedTemplateOutcome, SavedTemplatesReturn, SavedTemplatesSource
} from './useSavedTemplates';

export type ContentBriefTemplateMutationOutcome = SavedTemplateOutcome<ContentBriefTemplate>;

export type UseContentBriefTemplatesReturn = SavedTemplatesReturn<
  ContentBriefTemplate,
  ContentBriefTemplateDraft,
  ContentBriefTemplateChanges
>;

const CONTENT_BRIEF_TEMPLATES: SavedTemplatesSource<
  ContentBriefTemplate,
  ContentBriefTemplateDraft,
  ContentBriefTemplateChanges
> = {
  errorScope: 'content',
  logTag: '[content]',
  subject: 'Content Brief template',
  list: () => fetchContentBriefTemplates(),
  create: createContentBriefTemplate,
  update: updateContentBriefTemplate,
  remove: deleteContentBriefTemplate,
  compareSaved: (left, right) => {
    const byName = compareTemplateNames(left, right);
    return byName === 0 ? left.id.localeCompare(right.id) : byName;
  },
  guardBuiltins: true,
};

export function useContentBriefTemplates(): UseContentBriefTemplatesReturn {
  return useSavedTemplates(CONTENT_BRIEF_TEMPLATES);
}
