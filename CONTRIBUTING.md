# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary
information to effectively respond to your bug report or contribution.


## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

* A reproducible test case or series of steps
* The version of our code being used (Settings page or the About dialog, or `version` in `package.json`)
* Any modifications you've made relevant to the bug
* Anything unusual about your environment or deployment


## Contributing via Pull Requests
Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the *main* branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

To send us a pull request, please:

1. Fork the repository.
2. Modify the source; please focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
3. Run the local gates below and make sure they are clean.
4. Name the tenets the change touches in the pull request's `## Tenets` section ([TENETS.md](TENETS.md)).
5. Bump the version and add a changelog entry if the change touches anything that ships (see [Versioning and changelog](#versioning-and-changelog)).
6. Commit to your fork using clear commit messages.
7. Send us a pull request, answering any default questions in the pull request interface.
8. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).


## Local gates

Set up the Python toolchain and build both Lambda layers once:

```bash
npm install && (cd web && npm install)
python3.12 -m venv .venv && .venv/bin/pip install -r lambda/requirements-dev.txt
bash lambda/layer/build-layer.sh
bash lambda/crawler-layer/build-layer.sh
```

Install the scanners the gate runs (macOS: `brew install gitleaks actionlint zizmor shellcheck`; elsewhere their
GitHub releases). `quality-gates.yml` pins the versions CI uses.

- **`npm run validate`** from the repo root runs every gate (`scripts/validate.sh`) in parallel lanes and stops at
  the first failure: Python (ruff, pyright, vulture, the contract checks, pytest), TypeScript (`tsc` and knip for
  the CDK app and the dashboard, the version check, the repo scripts' tests), lint (ESLint, jscpd, gitleaks,
  actionlint + zizmor), the CDK Vitest suite (after a `vite build` of the dashboard), the dashboard Vitest suite,
  and **CodeQL** (`scripts/codeql-local.sh`): the code-quality queries the github-code-quality review comments
  from, over Python and JavaScript/TypeScript, failing on any result. Install the CodeQL CLI once with
  `gh extension install github/gh-codeql` (free for open source; the step is skipped with a notice when no CLI is
  installed, `CODEQL_REQUIRED=1` makes that a failure). **`npm run validate:help`** explains every lane, option and
  log, and the workflow an agent follows on a failure; `npm run validate:failed` re-runs only what did not pass,
  and `npm run validate:python` / `validate:web` run one area. Step logs are kept in `.cache/validate/logs/`. The
  limits each gate enforces are in [README.md, "Validation"](README.md#validation). Fix findings; never raise a
  limit or suppress a finding inline.
- **Pre-push hook.** `npm install` (its `prepare` script) or `npm run hooks:install` links `.githooks/pre-push` into
  `.git/hooks/`, so every `git push` runs `npm run validate` first and stops on a failure. Pushes that only delete
  branches or tags skip it. Don't use `git push --no-verify`, which also skips Code Defender's checks on machines
  that have it; for an emergency push use `SKIP_VALIDATE=1 git push` and say so in the pull request.
- **Layer rebuilds.** Both layers carry a copy of `lambda/shared`, and `cdk synth` fails when either copy is
  missing or stale. After changing anything in `lambda/shared/`, or a layer's `requirements.txt`, rerun
  `bash lambda/layer/build-layer.sh` and `bash lambda/crawler-layer/build-layer.sh`. The Python tests also import
  runtime libraries from the built shared layer. `scripts/deploy.sh` rebuilds both layers itself.
- **Mutation testing** is not part of `validate`. Run it on the modules your change touches and resolve every
  surviving mutant with a test or by deleting the inert code:

  ```bash
  # Python (mutmut, needs Python 3.12); --patch <git-range> mutates only the changed lines
  npm run mutation:python -- lambda/shared/scope_params.py lambda/shared/test_scope_params.py
  # Dashboard (Stryker); a genuinely equivalent mutant gets a `// Stryker disable` comment with the reason
  (cd web && npm run mutation -- --mutate src/hooks/useAnalysisEndpoint.ts)
  ```

### Test conventions

- Tests live beside the code they test.
  - CDK and dashboard: `*.spec.ts` / `*.spec.tsx` next to the module, run by Vitest (`vitest.config.ts` at the root
    covers `lib/**/*.spec.ts`; `web/vite.config.ts` runs the dashboard specs in jsdom).
  - Lambda: `test_*.py` next to the Python module, run by pytest from the repo root (`testpaths = ["lambda"]` in
    `pyproject.toml`).
- Shared test builders go in fixture files, not in the test file: `<module>-fixtures.ts` next to the spec,
  `web/src/test/`, and `lambda/testing/`. A custom ESLint rule rejects helper functions defined inside spec files.
- UI rules are in [docs/design-system.md](docs/design-system.md); KPI formulas in
  [docs/kpi-definitions.md](docs/kpi-definitions.md) (`lambda/shared/test_kpi_contract.py` keeps that document, the
  KPI engine and the dashboard definitions in step).


## Continuous integration

Every workflow under `.github/workflows/` pins its actions to commit SHAs, holds the least permissions it needs and
keeps no checkout credential; `actionlint` and `zizmor` check that in the gate.

| Workflow | When | What |
|---|---|---|
| `quality gates` | every pull request, pushes to `main` | `scripts/validate.sh --lane <lane>`, one job per lane (`py`, `tsc`, `lint`, `test`, `web`), and a final `scripts/validate.sh` check that is green only when every lane is. CodeQL runs as GitHub code scanning instead of here. |
| `version and changelog check` | pull requests to `main` | the version bump and changelog entry below |
| `dependency review` | every pull request | a dependency the PR adds or changes must carry a license from `.github/dependency-review-config.yml` |
| `dependency audit` | PRs that touch a manifest, lockfile or requirements file; Mondays 05:23 UTC; by hand | `scripts/dependency-audit.mjs` (see Dependencies) |
| `Kiro review` | pull requests to `main` from this repository (not forks, drafts or Dependabot) | a read-only Kiro CLI agent reviews the diff against `TENETS.md`, `README.md` and this file, and posts one comment it updates on every push (see Kiro review) |
| `Kiro issue triage` | every new issue; comments by the author on an `enhancement` issue | a read-only Kiro CLI agent labels the issue (bug, enhancement, documentation, question, invalid) and replies; for a feature request it checks the tenets and helps the author align it (see Kiro review) |
| `scheduled failure watch` | after each scheduled `dependency audit` | opens an issue when the scheduled run fails, comments while it keeps failing, closes it when it is green again |

Dependabot (`.github/dependabot.yml`) opens grouped minor and patch updates every Monday for the actions, both npm
lockfiles and the Python requirements, never for a release younger than seven days.

## Kiro review

`.github/workflows/kiro-review.yml` runs [Kiro CLI in headless mode](https://kiro.dev/docs/cli/headless/) with the
agent in `scripts/kiro-review/` (`agent.json`, its prompt and the task). The agent checks the change against the
tenets, the repository rules and correctness and security, and answers with a verdict (`PASS`, `CONCERNS` or
`BLOCKING`), blocking findings, concerns and a tenet table. It reads the diff without the two npm lockfiles; their
line counts and up to 40 changed lines each come in a separate input, enough to tell a version bump from a dependency
change. The comment is advisory: set `KIRO_REVIEW_ENFORCED` to
`'true'` in the workflow to fail the check on `BLOCKING`.

- **Setup.** Create a dedicated Kiro API key for CI (Kiro Pro or above; an administrator may need to allow API keys)
  and store it as the repository secret `KIRO_API_KEY` with `gh secret set KIRO_API_KEY` (it prompts for the value,
  so the key never lands in shell history) or in Settings › Secrets and variables › Actions. Never paste a key in
  code, a commit, an issue or a chat; if one was shared, revoke it and create another. The agent runs on `claude-opus-5.5`
  (`agent.json`); the repository variable `KIRO_REVIEW_MODEL` overrides it. The model list depends on the account:
  `kiro-cli chat --v3 --list-models` shows the key's models only when no browser login is active, because a
  `kiro-cli login` session takes precedence over `KIRO_API_KEY`. A repository without the secret skips the review.
- **How the key stays private.** The workflow uses `pull_request`, so a pull request from a fork gets no secrets
  (and is skipped). The key reaches only the step that runs Kiro, as an environment variable. The agent, its prompt
  and the documents it judges against come from `main`, so a pull request cannot change its own review. The pull
  request's files are read as data: nothing from it is built or run, and its `.kiro/` folder is deleted first. The
  agent can only read files under the review root (`--trust-tools` is not used, because in Kiro CLI 3.1.0 it let a
  read outside the agent's rules through); writes, shell, web, MCP and sub-agents are denied. A separate job with no
  secret posts the comment after `scripts/kiro-review/comment.mjs` refuses anything that looks like a credential.
  Anyone who can push a branch here can still edit the workflow in their pull request, so give the CI key a small
  usage limit and rotate it if a collaborator leaves.
- **Issue triage.** `.github/workflows/kiro-issue-triage.yml` runs the agent in `scripts/kiro-issue/` on every new
  issue with the same key and the same read-only limits. It sets one type label (`bug`, `enhancement`,
  `documentation`, `question` or `invalid`), replacing the template's label on the first triage only, and replies.
  For a feature request it names the tenets the request touches, labels it `tenets: aligned`, `tenets: needs
  alignment` or `tenets: conflicts`, proposes the closest version that fits the tenets, and drafts the request
  in the feature template's structure plus **Tenets touched** and **Acceptance criteria**. When the issue's author
  answers, it replies again and updates the tenet label, at most five times per issue; after that, or at any
  point, a maintainer takes over. Issue text is untrusted input from anyone, so it is only ever read as data.
- **Changing the reviewer.** Edit `scripts/kiro-review/`; the change applies to pull requests opened after it
  merges. To try it locally, put `agent.json` (with `__REVIEW_ROOT__` replaced by a directory holding `trusted/`,
  `data/` and `pr/` as the workflow lays them out) and the prompt in that directory's `.kiro/agents/`, and run
  `kiro-cli chat --v3 --no-interactive --agent citation-pr-reviewer < scripts/kiro-review/task.md` from it.

## Dependencies

- **Audit.** `npm run deps:audit` (`scripts/dependency-audit.mjs`) checks both npm lockfiles with `npm audit` and
  both Lambda layers' requirements with `pip-audit` (`pip install pip-audit`), resolved for the Lambda target
  (CPython 3.12, x86_64). It fails on an npm production advisory of high or critical severity, an npm
  development advisory of critical severity, any advisory in a layer, and an audit that could not run;
  `lambda/requirements-dev.txt` is reported only.
- **Reviewed ignores.** An advisory that cannot reach us, or has no fix yet, goes into
  `.github/dependency-audit-ignore.json` with its id, package, the reason and an expiry at most 90 days ahead. An
  expired or malformed entry fails the audit; an entry that matches nothing is reported so it can be deleted.
- **A red scheduled audit** has an issue titled `Scheduled workflow failing: dependency audit`. Update the
  dependency (or add a reviewed ignore) in a pull request; the next green scheduled run closes the issue.
- **Dependabot pull requests** change what ships, so they need the version bump below: check out the branch, run
  `npm version <x.y.z> --no-git-tag-version` at the root and in `web/`, add the `CHANGELOG.md` entry, push, merge.
- **Licenses.** A new dependency must carry a license from `.github/dependency-review-config.yml`; anything else
  needs a reviewed exception there with its reason, and an entry in `THIRD_PARTY_LICENSES.md`.

## Versioning and changelog

The app follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version lives in **two** files that must always carry the same value —
`package.json` and `web/package.json` — because the web build bakes
`web/package.json`'s version into the dashboard (Settings page and About
modal) via `vite.config.ts`.

Every pull request that changes what ships (listed below) must, in the same PR:

1. **Bump the version** in both files:

   ```bash
   npm version <new-version> --no-git-tag-version
   (cd web && npm version <new-version> --no-git-tag-version)
   ```

2. **Add a `CHANGELOG.md` entry** headed `## [<new-version>] - <YYYY-MM-DD>`, in
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

Choosing the bump:

- **Major** — breaking changes: API request/response contracts, authentication
  or authorization behavior, or releases that need manual steps before
  `cdk deploy` succeeds.
- **Minor** — new features and backwards-compatible behavior changes.
- **Patch** — bug fixes and internal changes with no behavior change for
  users or API clients.

The `version-check` workflow (`.github/workflows/version-check.yml`) enforces
this on every pull request to `main`. It requires a bump when anything that
ships changed:

- a file under `lambda/`, `lib/`, `bin/`, `web/src/` or `scripts/`, or
  `web/index.html`, `web/vite.config.ts` or `cdk.json`;
- the declared dependencies or `overrides` of either `package.json`;
- any resolved package in either lock file (a transitive update counts).

Everything else is exempt: docs and Markdown files, `.github/`, `.kiro/`, the
`scripts` and version fields of `package.json`, and lint and test
configuration. When a bump is required, the check fails if the two
`package.json` versions differ, if the version equals the one on `main`, or if
`CHANGELOG.md` has no `## [<version>]` heading for it. Dependabot cannot bump
the version itself, so a maintainer adds the bump and the changelog entry to a
Dependabot branch before merging it.

Commit messages on `main` largely follow
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
`fix:`, `chore:`) and end with the release version, e.g.
`fix: provider toggle no longer erases the provider row (2.16.2)`.


## Finding contributions to work on
Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.


## Code of Conduct
This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.


## Security issue notifications
If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue. See [SECURITY.md](SECURITY.md).


## Licensing

See the [LICENSE](LICENSE) file for our project's licensing (MIT-0). We will ask you to confirm the licensing of your contribution. Third-party dependencies and their licenses are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
