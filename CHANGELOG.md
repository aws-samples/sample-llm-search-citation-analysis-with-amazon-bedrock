# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version is kept identical in `package.json` and `web/package.json` and is
shown in the dashboard under Settings and the About modal. See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning-and-changelog) for the release
process.

## [2.0.0] - 2026-08-20

Audit-driven refactor and hardening release (#103). Major version because it
changes the API contract for existing clients and requires manual preparation
before deploying — see the "Before deploying" section of the PR.

### Changed

- **Breaking:** every mutating API route now requires membership in the
  Cognito `Admin` group; unauthorized callers receive 403. Ensure at least one
  user is in the group before deploying — with an empty group there is no
  in-app recovery.
- **Breaking:** `PUT /users/{username}` requires `groups` to be an array of
  strings; self-edits of `groups`/`enabled` and self-deletion are refused even
  for admins.
- **Breaking:** `GET /users/{username}` returns the single user instead of the
  full roster (routing bug fix, but a response-shape change).
- **Breaking:** a plain `cdk deploy` of this release fails without
  preparation: 12 API Lambda log groups come under CDK management (30-day
  retention) and most already exist in deployed accounts. Delete or
  `cdk import` them first; failed attempts compound because `Retain` is
  honored during rollback.
- Every provider now receives the identical query: OpenAI loses its
  "Search for information about:" prefix and Claude's citation instruction
  moves to a system prompt. Citation metrics before and after this release are
  not directly comparable.
- Cognito token lifetimes: access/ID 8h → 1h, refresh 8h → 7 days (a disabled
  user is now locked out within an hour).
- Step Functions logging OFF → ALL with execution data, 30-day retention
  (keyword and citation payloads now land in CloudWatch).
- Screenshots transition to S3 Infrequent Access at 90 days instead of being
  deleted; async dispatch failures return 503 with a terminal job row instead
  of silently running the job inline.

### Added

- Provider health tracking: failures classified (no credit, invalid key, rate
  limited, timeout), recorded per provider row, surfaced on `GET /providers`,
  and rendered in the dashboard (app-wide banner and Settings badges).
  Providers auto-disable after three consecutive terminal failures;
  re-enabling is deliberately manual.
- Shared Lambda modules consolidating duplicated logic: AI clients, secrets
  access, SSRF-safe fetching, keyword persistence, async self-invocation,
  stale-job sweeps, provider-health classification, Decimal handling, and
  group-based authorization.
- Admin-aware UI: non-admin users no longer see mutating controls; 403
  responses map to a dedicated permission error category instead of looking
  like session expiry.
- Synth-time regression gates: layer staleness, log-group retention/policy,
  and the search role's DynamoDB permissions on the provider config table.

### Fixed

- `GET /users/{username}` returned the entire roster via dead-code dispatch.
- Presigned URLs and raw-response reads are confined to their bucket's
  expected prefixes.
- "Latest run" reads no longer stop at DynamoDB's 1 MB page boundary.
- Cache-key collisions for keywords containing `#`.
- Provider-health writes were denied by IAM and `GET /providers` omitted the
  health fields, leaving the health feature dark end to end (review blockers).
- Search prompt tests failed under explicit-path pytest invocations
  (collection-order module pollution on the shared `handler` name).

### Removed

- The never-associated regional API WAF (API Gateway stage throttling
  remains in place).

## [1.1.0] - 2026-08-14

History before this changelog existed, summarized from the git log. Covers
everything merged between the initial release and the version bump in #96.

### Added

- App version display on the Settings page and About modal with content
  freshness (#96, #102).
- Keyword-linked schedules and scheduled-run prompt input fixes (#92).
- Onboarding setup checklist for new installations (#89).
- Add keywords directly from keyword/competitor research (#83).

### Fixed

- Personas header text overflow (#100); repo-wide eslint/ruff debt cleared
  (#94); lockfiles refreshed clearing npm audit findings (#98).

## [1.0.0] - 2026-02-17

### Added

- Initial release of the Citation Analysis System.
