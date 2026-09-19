import {
  describe, expect, it
} from 'vitest';
import { buildAlertSettings } from '../../types/domain/alerts-fixtures';
import {
  alertSettingsFormValues,
  MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH,
  MAX_CONTENT_CHANGE_URL_LENGTH,
  toAlertSettingsUpdate,
  toContentChangeRequest,
  validateAlertSettingsForm,
  validateContentChangeForm,
} from './alertFormModel';
import {
  buildAlertSettingsFormValues, buildContentChangeFormValues
} from './alertFormModel-fixtures';

describe('alert form model', () => {
  describe('alert settings', () => {
    it('deduplicates notification emails from server settings ignoring case', () => {
      const settings = buildAlertSettings({
        notification_emails: [
          'alerts@example.com',
          'ALERTS@example.com',
          'ops@example.com',
        ],
      });

      expect(alertSettingsFormValues(settings).notificationEmailsText).toBe(
        'alerts@example.com\nops@example.com'
      );
    });

    it('builds the full settings payload with deduplicated trimmed emails', () => {
      const values = buildAlertSettingsFormValues({
        enabled: false,
        notificationEmailsText: ' alerts@example.com,ALERTS@example.com\nops@example.com ',
        citationRateDrop: '0.1',
        positionLoss: '2.5',
        competitorTopN: '10',
        improvementAfterContentChange: '100',
      });

      expect(toAlertSettingsUpdate(values)).toStrictEqual({
        enabled: false,
        notification_emails: ['alerts@example.com', 'ops@example.com'],
        thresholds: {
          citation_rate_drop: 0.1,
          position_loss: 2.5,
          competitor_top_n: 10,
          improvement_after_content_change: 100,
        },
      });
    });

    it.each([
      ['Citation-rate drop must be a number', { citationRateDrop: '' }],
      ['Citation-rate drop must be at least 0.1', { citationRateDrop: '0' }],
      ['Position loss must be a number', { positionLoss: 'Infinity' }],
      ['Position loss must be at most 100', { positionLoss: '100.1' }],
      ['Competitor top N must be at most 10', { competitorTopN: '11' }],
      ['Improvement after content change must be at most 100', { improvementAfterContentChange: '101' }],
      ['Enter a valid notification email: invalid-email', { notificationEmailsText: 'invalid-email' }],
    ])('returns "%s" when settings are invalid', (message, overrides) => {
      expect(validateAlertSettingsForm(buildAlertSettingsFormValues(overrides))).toBe(message);
    });
  });

  describe('content changes', () => {
    it('builds a trimmed marker request with an HTTPS URL', () => {
      const values = buildContentChangeFormValues({
        description: '  Published revised guidance  ',
        url: '  https://example.com/guidance  ',
      });

      expect(toContentChangeRequest(values)).toStrictEqual({
        group_id: 'group-north',
        description: 'Published revised guidance',
        url: 'https://example.com/guidance',
      });
    });

    it('omits the optional URL when it is blank', () => {
      expect(toContentChangeRequest(buildContentChangeFormValues({ url: '   ' }))).toStrictEqual({
        group_id: 'group-north',
        description: 'Updated the product comparison page',
      });
    });

    it.each([
      ['Select a keyword group', { groupId: '' }],
      ['Describe the content change', { description: '   ' }],
      [
        `Description must be at most ${MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH} characters`,
        { description: 'x'.repeat(MAX_CONTENT_CHANGE_DESCRIPTION_LENGTH + 1) },
      ],
      ['URL must start with http:// or https://', { url: 'ftp://example.com/page' }],
      [
        `URL must be at most ${MAX_CONTENT_CHANGE_URL_LENGTH} characters`,
        { url: `https://example.com/${'x'.repeat(MAX_CONTENT_CHANGE_URL_LENGTH)}` },
      ],
    ])('returns "%s" when a marker is invalid', (message, overrides) => {
      expect(validateContentChangeForm(buildContentChangeFormValues(overrides))).toBe(message);
    });
  });
});
