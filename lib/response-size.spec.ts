import {
  describe, expect, it
} from 'vitest';
import {
  API_FUNCTION_NAMES, declaredRoutes, readRouteSizePolicies, synthesizeResponseSizeSnapshot
} from './response-size-fixtures';

/**
 * Response size (2.41.0). A Lambda proxy response is capped at 6 MiB; every
 * route declares how its response is bounded in
 * `test-fixtures/route-size-policies.json` (checked against the route maps by
 * `lambda/api/test_route_size_policies.py`), and a response that still
 * outgrows the cap is spilled to the keywords bucket behind a presigned URL.
 */
const snapshot = synthesizeResponseSizeSnapshot();
const policies = readRouteSizePolicies();

describe('Route size-policy registry', () => {
  it('declares a size policy for every API Gateway route', () => {
    const declared = new Set(declaredRoutes(policies));

    expect(snapshot.apiRoutes.filter((route) => !declared.has(route))).toStrictEqual([]);
  });

  it('declares no route the API does not serve', () => {
    const served = new Set(snapshot.apiRoutes);

    expect(declaredRoutes(policies).filter((route) => !served.has(route))).toStrictEqual([]);
  });

  it('declares each route once', () => {
    const routes = declaredRoutes(policies);

    expect(routes.filter((route, index) => routes.indexOf(route) !== index)).toStrictEqual([]);
  });
});

describe('Spilled API responses', () => {
  it.each(API_FUNCTION_NAMES)('names the keywords bucket as the spill bucket of %s', (functionName) => {
    expect(snapshot.spillAccess[functionName].bucketEnv).toStrictEqual({ Ref: snapshot.keywordsBucketLogicalId });
  });

  it.each(API_FUNCTION_NAMES)('lets %s write and presign objects under api-responses/', (functionName) => {
    expect(snapshot.spillAccess[functionName].bucketActions).toStrictEqual(expect.arrayContaining(['s3:PutObject', 's3:GetObject']));
    expect(snapshot.spillAccess[functionName].grantsSpillPrefix).toBe(true);
  });

  it('lets only the dashboard origin read presigned objects from the browser', () => {
    expect(snapshot.keywordsBucketCors).toStrictEqual({
      CorsRules: [{
        AllowedMethods: ['GET'],
        AllowedOrigins: [{ 'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [expect.stringMatching(/^WebDistribution/), 'DomainName'] }]] }],
        AllowedHeaders: [],
        MaxAge: 3600,
      }],
    });
  });
});

describe('API compression', () => {
  it('compresses responses of 1 KiB or more for clients that accept gzip', () => {
    expect(snapshot.minimumCompressionSize).toBe(1024);
  });
});
