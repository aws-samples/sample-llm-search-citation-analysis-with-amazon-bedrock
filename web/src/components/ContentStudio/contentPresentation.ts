import type {
  ContentStudioHistory, ContentWarning
} from '../../types';

export function getContentTitle(item: ContentStudioHistory): string {
  // `||`, not `??`: an empty generated title must fall through to the idea title.
  const generatedTitle = item.generated_content?.title.trim() ?? '';
  return generatedTitle || item.idea_title.trim() || item.keyword.trim();
}

export function formatContentWarning(warning: ContentWarning): string {
  const missingFields = warning.missing_fields
    .map((field) => field.replaceAll('_', ' '))
    .join(', ');

  return missingFields
    ? `${warning.message} Missing: ${missingFields}.`
    : warning.message;
}
