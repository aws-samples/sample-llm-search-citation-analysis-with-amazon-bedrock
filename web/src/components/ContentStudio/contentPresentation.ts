import type {
  ContentStudioHistory, ContentWarning
} from '../../types';

export function getContentTitle(item: ContentStudioHistory): string {
  return (
    item.generated_content?.title?.trim()
    || item.idea_title.trim()
    || item.keyword.trim()
  );
}

export function formatContentWarning(warning: ContentWarning): string {
  const missingFields = warning.missing_fields
    .map((field) => field.replaceAll('_', ' '))
    .join(', ');

  return missingFields
    ? `${warning.message} Missing: ${missingFields}.`
    : warning.message;
}
