import {
  describe, expect, it
} from 'vitest';
import {
  allowStatementsOfRole, extractReservedConcurrency, findFunctionRoleLogicalId, resolvePath, statementActions
} from './citation-analysis-stack-fixtures';
import { GATE_KEY_PREFIX, SEO_CALLBACKS_FUNCTION_NAME } from './constructs/seo-callbacks';
import { sharedFunctionEnvironments, synthesizeSeoFeatureTemplate } from './seo-feature-fixtures';

/** `SeoCallbacks`: the public DataForSEO pingback endpoint that resumes gated state machines. */
const template = synthesizeSeoFeatureTemplate();
const statements = allowStatementsOfRole(template, findFunctionRoleLogicalId(template, SEO_CALLBACKS_FUNCTION_NAME));
const urls = Object.values(template.findResources('AWS::Lambda::Url'));

describe('CitationAnalysis-SeoCallbacks', () => {
  it('is reached through one function URL without sign-in (DataForSEO cannot sign in)', () => {
    expect(urls.map((url) => resolvePath(url, ['Properties', 'AuthType']))).toStrictEqual(['NONE']);
  });

  it('reserves 5 concurrent executions, since a function URL has no throttle of its own', () => {
    expect(extractReservedConcurrency(template, SEO_CALLBACKS_FUNCTION_NAME)).toBe(5);
  });

  it('may only update gate items of the cache table and resume the gated state machines', () => {
    expect(statements.map(statementActions).flat().sort((a, b) => a.localeCompare(b))).toStrictEqual([
      'dynamodb:UpdateItem', 'states:SendTaskSuccess',
    ]);
  });

  it('limits its table writes to the gate items by their key prefix', () => {
    const update = statements.find((statement) => statementActions(statement).includes('dynamodb:UpdateItem'));

    expect(resolvePath(update, ['Condition'])).toStrictEqual({
      'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': [`${GATE_KEY_PREFIX}*`] },
    });
  });

  it('gives the jobs function the URL to send as each task\'s pingback_url', () => {
    expect(sharedFunctionEnvironments(template).jobsEnv).toHaveProperty('DATAFORSEO_CALLBACK_URL');
  });
});
