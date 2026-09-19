import {
  describe, expect, it
} from 'vitest';
import {
  dimensionIdFromLabel,
  draftDimensions,
  draftFromTemplate,
  hasTemplateDraftProblems,
  newTemplateDraft,
  templateChanges,
  templateDraftProblems,
} from './agentTemplateDraft';
import type { TemplateDraftFields } from './agentTemplateDraft';
import {
  buildCafeTemplate, buildSavedTemplate, buildTemplate
} from './agent-fixtures';

const PROMPT = 'You research urban hotels for business travellers.';

const SAVED_DRAFT: TemplateDraftFields = draftFromTemplate(buildSavedTemplate());

describe('dimensionIdFromLabel', () => {
  it.each([
    ['Destination', 'destination'],
    ['Points of interest', 'points_of_interest'],
    ['Location / neighbourhood', 'location_neighbourhood'],
    ['Menú & bebidas', 'menu_bebidas'],
    ['  trip-type  ', 'trip_type'],
    ['already_an_id', 'already_an_id'],
  ])('derives %s → %s', (label, id) => {
    expect(dimensionIdFromLabel(label)).toBe(id);
  });

  it('cuts the id at 40 characters', () => {
    expect(dimensionIdFromLabel('a'.repeat(50))).toHaveLength(40);
  });

  it('is empty when the label has no letters or digits', () => {
    expect(dimensionIdFromLabel('&&&')).toBe('');
  });
});

describe('draftFromTemplate', () => {
  it('names the draft as a copy when the template is built-in', () => {
    expect(draftFromTemplate(buildTemplate()).name).toBe('Hotels (copy)');
  });

  it('keeps the name and profile when the template is saved', () => {
    const draft = draftFromTemplate(buildSavedTemplate());

    expect(draft.name).toBe('Urban hotels');
    expect(draft.subject).toBe('hotel');
    expect(draft.audience).toBe('travellers');
  });

  it('keys each dimension row by its id and keeps the stored id', () => {
    const draft = draftFromTemplate(buildCafeTemplate());

    expect(draft.rows.map((row) => row.key)).toStrictEqual(['menu', 'location', 'occasion']);
    expect(draft.rows[0]).toStrictEqual({
      key: 'menu',
      id: 'menu',
      label: 'Menu & drinks',
      description: 'specialty coffee, brunch, pastries, vegan options',
    });
  });
});

describe('draftDimensions', () => {
  it('derives the id from the label and trims the texts when the row is new', () => {
    expect(draftDimensions([{
      key: 'n1',
      label: ' Menu & drinks ',
      description: ' brunch ',
    }])).toStrictEqual([{
      id: 'menu_drinks',
      label: 'Menu & drinks',
      description: 'brunch',
    }]);
  });

  it('keeps the stored id when the row came from the template, whatever its label', () => {
    expect(draftDimensions([{
      key: 'location',
      id: 'location',
      label: 'Location / neighbourhood',
      description: '',
    }])[0].id).toBe('location');
  });
});

describe('templateDraftProblems', () => {
  it('has no problems for a saved template as it is', () => {
    const problems = templateDraftProblems(SAVED_DRAFT, PROMPT);

    expect(problems).toStrictEqual({ rows: {} });
    expect(hasTemplateDraftProblems(problems)).toBe(false);
  });

  it('requires a name', () => {
    expect(templateDraftProblems({
      ...SAVED_DRAFT,
      name: '  ',
    }, PROMPT).name).toBe('Enter a template name.');
  });

  it.each([
    ['too short', 'x', 'Enter the subject (at least 2 characters).'],
    ['not plain words', 'hotel 5*', 'The subject is plain words: letters, spaces, hyphens and apostrophes, at most 40 characters.'],
    ['longer than 40 characters', 'h'.repeat(41), 'The subject is plain words: letters, spaces, hyphens and apostrophes, at most 40 characters.'],
  ])('rejects a subject that is %s', (_case, subject, message) => {
    expect(templateDraftProblems({
      ...SAVED_DRAFT,
      subject,
    }, PROMPT).subject).toBe(message);
  });

  it.each([
    ['an accent', 'café'],
    ['two words', 'coffee drinkers'],
    ['hyphens', 'bed-and-breakfast'],
    ['apostrophes', 'O\u2019Reilly\'s'],
  ])('accepts %s as plain words', (_case, audience) => {
    expect(templateDraftProblems({
      ...SAVED_DRAFT,
      audience,
    }, PROMPT).audience).toBeUndefined();
  });

  it('flags a row without a label', () => {
    const problems = templateDraftProblems({
      ...SAVED_DRAFT,
      rows: [...SAVED_DRAFT.rows, {
        key: 'new-1',
        label: '  ',
        description: '',
      }],
    }, PROMPT);

    expect(problems.rows).toStrictEqual({ 'new-1': 'Enter a label.' });
  });

  it('flags a label whose id duplicates an earlier row', () => {
    const problems = templateDraftProblems({
      ...SAVED_DRAFT,
      rows: [...SAVED_DRAFT.rows, {
        key: 'new-1',
        label: 'DESTINATION',
        description: '',
      }],
    }, PROMPT);

    expect(problems.rows).toStrictEqual({ 'new-1': 'Duplicate of another dimension (destination).' });
  });

  it('reserves Other for the agent', () => {
    const problems = templateDraftProblems({
      ...SAVED_DRAFT,
      rows: [...SAVED_DRAFT.rows, {
        key: 'new-1',
        label: 'Other',
        description: '',
      }],
    }, PROMPT);

    expect(problems.rows['new-1']).toBe('"Other" is reserved for the agent\u2019s catch-all bucket.');
  });

  it('requires the id to start with a letter', () => {
    const problems = templateDraftProblems({
      ...SAVED_DRAFT,
      rows: [...SAVED_DRAFT.rows, {
        key: 'new-1',
        label: '2 for 1',
        description: '',
      }],
    }, PROMPT);

    expect(problems.rows['new-1']).toBe('The label must start with a letter and contain a letter or digit after it.');
  });

  it('requires at least two dimensions', () => {
    expect(templateDraftProblems({
      ...SAVED_DRAFT,
      rows: SAVED_DRAFT.rows.slice(0, 1),
    }, PROMPT).dimensions).toBe('Add at least 2 dimensions.');
  });

  it('allows at most twelve dimensions', () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      key: `r${index}`,
      label: `Dimension ${index}`,
      description: '',
    }));

    expect(templateDraftProblems({
      ...SAVED_DRAFT,
      rows,
    }, PROMPT).dimensions).toBe('At most 12 dimensions.');
  });

  it('rejects instructions that are too short', () => {
    expect(templateDraftProblems(SAVED_DRAFT, 'short').systemPrompt).toBe('The instructions are too short.');
  });
});

describe('newTemplateDraft', () => {
  it('derives the template from the selected one and trims the texts', () => {
    const draft = newTemplateDraft(buildTemplate(), {
      ...draftFromTemplate(buildTemplate()),
      name: ' Beach resorts ',
      subject: ' resort ',
      audience: ' families ',
    }, 'You research beach resorts.');

    expect(draft).toStrictEqual({
      name: 'Beach resorts',
      description: 'Built-in starting point for hotels and resorts.',
      systemPrompt: 'You research beach resorts.',
      baseTemplateId: 'builtin-default',
      subject: 'resort',
      audience: 'families',
      dimensions: buildTemplate().dimensions,
    });
  });
});

describe('templateChanges', () => {
  it('is empty when the draft matches the saved template', () => {
    expect(templateChanges(buildSavedTemplate(), SAVED_DRAFT, PROMPT)).toStrictEqual({});
  });

  it('includes only the fields that differ', () => {
    expect(templateChanges(buildSavedTemplate(), {
      ...SAVED_DRAFT,
      name: 'City hotels',
      audience: 'business travellers',
    }, PROMPT)).toStrictEqual({
      name: 'City hotels',
      audience: 'business travellers',
    });
  });

  it('includes the prompt when it was edited', () => {
    expect(templateChanges(buildSavedTemplate(), SAVED_DRAFT, 'A different prompt for urban hotels.')).toStrictEqual({ systemPrompt: 'A different prompt for urban hotels.' });
  });

  it('includes the whole dimension list when one row changed', () => {
    const rows = SAVED_DRAFT.rows.map((row) => (row.key === 'audience' ? {
      ...row,
      description: 'families and couples',
    } : row));

    const changes = templateChanges(buildSavedTemplate(), {
      ...SAVED_DRAFT,
      rows,
    }, PROMPT);

    expect(changes.dimensions).toHaveLength(6);
    expect(changes.dimensions?.[4]).toStrictEqual({
      id: 'audience',
      label: 'Audience',
      description: 'families and couples',
    });
  });
});
