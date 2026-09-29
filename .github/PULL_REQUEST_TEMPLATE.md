## Description

Please include a summary of the change and which issue is fixed. Include relevant motivation and context.

Fixes # (issue)

## Type of change

Please delete options that are not relevant.

- [ ] Bug fix (non-breaking change which fixes an issue) — patch
- [ ] New feature (non-breaking change which adds functionality) — minor
- [ ] Breaking change (API contract, auth behavior, or a manual step before `cdk deploy`) — major
- [ ] Documentation or CI only (no version bump)

## How Has This Been Tested?

Please describe the tests that you ran to verify your changes. Provide instructions so we can reproduce.

- [ ] `npm run validate` passes from the repo root
- [ ] New or changed behavior is covered by tests beside the code (`*.spec.ts(x)` for CDK/dashboard, `test_*.py` for Lambda)
- [ ] Mutation testing run on the changed modules (`npm run mutation:python -- <module> <tests>`, `cd web && npm run mutation -- --mutate <file>`) and every survivor resolved
- [ ] Deployed to an AWS account and verified the change there (if it affects infrastructure or runtime behavior)

**Test Configuration**:
* AWS Region:
* AWS CDK CLI Version:
* Node.js Version:
* Python Version (Lambda runtime is 3.12):

## Checklist:

- [ ] The version is bumped in `package.json` **and** `web/package.json` and `CHANGELOG.md` has a `## [<version>]` entry (required when `lambda/`, `lib/`, `bin/`, `web/src/`, `scripts/`, `web/index.html`, `web/vite.config.ts`, `cdk.json`, the npm dependencies or a lock file changed — see [CONTRIBUTING.md](../CONTRIBUTING.md#versioning-and-changelog))
- [ ] Both Lambda layers rebuilt if `lambda/shared/` or a layer's `requirements.txt` changed (`bash lambda/layer/build-layer.sh`, `bash lambda/crawler-layer/build-layer.sh`)
- [ ] No lint limit raised and no inline suppression (`# noqa`, `eslint-disable`) added
- [ ] KPI changes are reflected in `docs/kpi-definitions.md`, `lambda/shared/kpi_engine.py` and `web/src/constants/kpiDefinitions.ts` together
- [ ] UI changes follow [docs/design-system.md](../docs/design-system.md)
- [ ] Other affected documentation (README, SECURITY.md, THIRD_PARTY_LICENSES.md for new dependencies) is updated
- [ ] I have performed a self-review of my own code
