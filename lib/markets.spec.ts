import {
  describe, expect, it
} from 'vitest';
import { FULLY_GUARDED, sortedHttpMethods, unguardedVerbs } from './citation-analysis-stack-fixtures';
import { synthesizeMarketsSnapshot } from './markets-fixtures';

/**
 * Markets (2.37.0): the market list lives in the BrandConfig table, so the
 * feature adds one API resource and no table; the main stack sits at the
 * 500-resource limit.
 */
const snapshot = synthesizeMarketsSnapshot();

describe('Main stack resource budget', () => {
  it('stays within the CloudFormation limit of 500 resources', () => {
    expect(snapshot.resourceCount).toBeLessThanOrEqual(500);
  });
});

describe('/api/markets', () => {
  it('serves GET, PUT and POST', () => {
    expect(sortedHttpMethods(snapshot.marketsMethods)).toStrictEqual(['GET', 'POST', 'PUT']);
  });

  it('puts every verb behind Cognito and the ConfigMgmt function', () => {
    expect(unguardedVerbs(snapshot.marketsMethods, snapshot.configMgmtFunctionLogicalId)).toStrictEqual(FULLY_GUARDED);
  });

  it('answers the CORS preflight like every other resource', () => {
    expect(snapshot.marketsPreflightCount).toBe(1);
  });
});

describe('ConfigMgmt markets wiring', () => {
  it('names the BrandConfig table the market list is stored in', () => {
    expect(snapshot.configMgmtBrandConfig.envRef).toStrictEqual({ Ref: snapshot.brandConfigTableLogicalId });
  });

  it('may read and write the market list', () => {
    expect(snapshot.configMgmtBrandConfig.actions).toStrictEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:PutItem']));
  });

  it('names the Keywords table the in-use check scans', () => {
    expect(snapshot.configMgmtKeywords.envRef).toStrictEqual({ Ref: snapshot.keywordsTableLogicalId });
  });

  it('may only read the Keywords table', () => {
    expect(snapshot.configMgmtKeywords.actions).toContain('dynamodb:Scan');
    expect(snapshot.configMgmtKeywords.actions).not.toContain('dynamodb:PutItem');
  });

  it('gets the Bedrock tier of the keyword suggestions', () => {
    expect(snapshot.configMgmtEnv.BEDROCK_TIER_GENERATION).toBe('fast');
  });
});

describe('Keyword markets', () => {
  it('lets KeywordMgmt check a keyword market against the market list', () => {
    expect(snapshot.keywordMgmtBrandConfig.envRef).toStrictEqual({ Ref: snapshot.brandConfigTableLogicalId });
    expect(snapshot.keywordMgmtBrandConfig.actions).toContain('dynamodb:GetItem');
  });

  it('gives KeywordMgmt no write access to the market list', () => {
    expect(snapshot.keywordMgmtBrandConfig.actions).not.toContain('dynamodb:PutItem');
  });

  it('lets ParseKeywords read the markets of the run', () => {
    expect(snapshot.parseKeywordsBrandConfig.envRef).toStrictEqual({ Ref: snapshot.brandConfigTableLogicalId });
    expect(snapshot.parseKeywordsBrandConfig.actions).toContain('dynamodb:GetItem');
  });
});

describe('ProcessKeywords market', () => {
  it('hands each keyword child its manifest entry market next to the keyword, timestamp and prompts', () => {
    expect(snapshot.processKeywordsItemSelector).toStrictEqual({
      'keyword.$': '$$.Map.Item.Value.keyword',
      'timestamp.$': '$$.Map.Item.Value.timestamp',
      'query_prompts.$': '$.query_prompts',
      'market.$': '$$.Map.Item.Value.market',
    });
  });
});
