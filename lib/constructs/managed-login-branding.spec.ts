import { describe, it, expect } from 'vitest';
import { runBrandingHandler, synthesizeBranding } from './managed-login-branding-fixtures';

const template = synthesizeBranding();
/** Create, read back, then patch the theme onto it: the form radius becomes the app's 8 px. */
const CREATE_AND_THEME = ['create', 'describe', 'update:radius=8.0'];

describe('managed-login branding handler', () => {
  it('creates and themes a style on Create when the client has none', () => {
    expect(runBrandingHandler(template, 'Create', false)).toStrictEqual({ calls: CREATE_AND_THEME, outcome: 'ok' });
  });

  it('recreates and themes the style on Update when the client lost it', () => {
    // 2.37.x upgrades: CloudFormation deleted the style this resource had
    // adopted, and Update only described it, so it failed or did nothing.
    expect(runBrandingHandler(template, 'Update', false)).toStrictEqual({ calls: CREATE_AND_THEME, outcome: 'ok' });
  });

  it('themes the existing style on Update when the client has one', () => {
    expect(runBrandingHandler(template, 'Update', true)).toStrictEqual({ calls: CREATE_AND_THEME, outcome: 'ok' });
  });

  it('leaves Cognito untouched on Delete', () => {
    expect(runBrandingHandler(template, 'Delete', true)).toStrictEqual({ calls: [], outcome: 'ok' });
  });
});
