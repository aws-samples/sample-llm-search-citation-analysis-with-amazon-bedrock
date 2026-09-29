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
4. Bump the version and add a changelog entry if the change touches application code (see [Versioning and changelog](#versioning-and-changelog)).
5. Commit to your fork using clear commit messages.
6. Send us a pull request, answering any default questions in the pull request interface.
7. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

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

- **`npm run validate`** from the repo root runs every gate and stops at the first failure: ESLint, `tsc`, the CDK
  Vitest suite, jscpd, knip, the contract checks (`npm run contracts`), the dashboard gate (`web`: `tsc --noEmit`,
  Vitest, knip) and the Python gate (`scripts/validate-python.sh`: ruff, pyright, vulture, jscpd, pytest). The
  step-by-step table and the limits each gate enforces are in [README.md, "Validation"](README.md#validation).
  Fix findings; never raise a limit or suppress a finding inline.
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


## Versioning and changelog

The app follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version lives in **two** files that must always carry the same value —
`package.json` and `web/package.json` — because the web build bakes
`web/package.json`'s version into the dashboard (Settings page and About
modal) via `vite.config.ts`.

Every pull request that changes application code must, in the same PR:

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
this on every pull request to `main`. It treats a change under `lambda/`,
`lib/`, `bin/`, `web/src/`, `scripts/`, or to `web/index.html` or `cdk.json`
as an application change; everything else (docs, Markdown files, `.github/`,
`.kiro/`, `package.json` and lock files, build and lint configuration) is
exempt. When application code changed, it fails if the two `package.json`
versions differ, if the version equals the one on `main`, or if
`CHANGELOG.md` has no `## [<version>]` heading for it.

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
