import {
  describe, expect, it
} from 'vitest';
import { synthesizeDashboardStacks } from './api-stack-fixtures';
import {
  extractFunctionRoleActionsOn, extractFunctionTimeout, extractLambdaEnvVars, extractTableProperty, findLogicalIdByName
} from './citation-analysis-stack-fixtures';

/**
 * Re-extract stored answers (2.55.0): the jobs table is the audit record of every rewrite, so it never expires and
 * no role may delete from it; the worker may only read and update SearchResults rows. One synthesis.
 */
const { mainTemplate: template } = synthesizeDashboardStacks('Reextract');
const JOBS_TABLE = 'CitationAnalysis-ReextractJobs';
const WORKER = 'CitationAnalysis-ReextractWorker';
const API = 'CitationAnalysis-API-ConfigMgmt';
const jobsTableId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', JOBS_TABLE);
const searchResultsId = findLogicalIdByName(template, 'AWS::DynamoDB::Table', 'TableName', 'CitationAnalysis-SearchResults');

describe('Re-extract jobs table', () => {
  it('keys jobs by job_id', () => {
    expect(extractTableProperty(template, JOBS_TABLE, 'KeySchema')).toStrictEqual([{ AttributeName: 'job_id', KeyType: 'HASH' }]);
  });

  it('has no TTL: jobs are the audit record of the answers they rewrote', () => {
    expect(extractTableProperty(template, JOBS_TABLE, 'TimeToLiveSpecification')).toBeUndefined();
  });

  it('lets the API read, start and update jobs but never delete one', () => {
    expect(extractFunctionRoleActionsOn(template, API, jobsTableId).sort((left, right) => left.localeCompare(right))).toStrictEqual([
      'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem',
    ]);
  });

  it('lets the worker only read and update a job', () => {
    expect(extractFunctionRoleActionsOn(template, WORKER, jobsTableId).sort((left, right) => left.localeCompare(right))).toStrictEqual(['dynamodb:GetItem', 'dynamodb:UpdateItem']);
  });
});

describe('Re-extract worker', () => {
  it('only queries and updates stored answers, never puts or deletes one', () => {
    expect(extractFunctionRoleActionsOn(template, WORKER, searchResultsId).sort((left, right) => left.localeCompare(right))).toStrictEqual(['dynamodb:Query', 'dynamodb:UpdateItem']);
  });

  it('runs up to Lambda limit of 900 s per pass', () => {
    expect(extractFunctionTimeout(template, WORKER)).toBe(900);
  });

  it('names the jobs table and the Deduplication Lambda it rebuilds the KPIs with', () => {
    const environment = extractLambdaEnvVars(template, WORKER);
    expect([environment.KPI_REBUILD_FUNCTION_NAME, typeof environment.DYNAMODB_TABLE_REEXTRACT_JOBS]).toStrictEqual([
      { Ref: findLogicalIdByName(template, 'AWS::Lambda::Function', 'FunctionName', 'CitationAnalysis-Deduplication') }, 'object',
    ]);
  });

  it('tells the API Lambda which worker to start', () => {
    expect(extractLambdaEnvVars(template, API).REEXTRACT_WORKER_FUNCTION_NAME).toBe(WORKER);
  });
});
