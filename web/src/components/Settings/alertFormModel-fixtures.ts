import type {
  AlertSettingsFormValues, ContentChangeFormValues
} from './alertFormModel';

export function buildAlertSettingsFormValues(
  overrides: Partial<AlertSettingsFormValues> = {}
): AlertSettingsFormValues {
  return {
    enabled: true,
    notificationEmailsText: 'alerts@example.com',
    citationRateDrop: '10',
    positionLoss: '3',
    competitorTopN: '5',
    improvementAfterContentChange: '8',
    ...overrides,
  };
}

export function buildContentChangeFormValues(
  overrides: Partial<ContentChangeFormValues> = {}
): ContentChangeFormValues {
  return {
    groupId: 'group-north',
    description: 'Updated the product comparison page',
    url: 'https://example.com/comparison',
    ...overrides,
  };
}
