# Third-Party Licenses

The direct third-party dependencies of the Citation Analysis System and their licenses. Versions are the ones resolved in
`package-lock.json` and `web/package-lock.json`, or the specifiers in the Lambda layer requirements files. Licenses are
the ones declared in the lockfiles or in the packages' own metadata. Test runners, linters and other development-only
tooling that is not bundled into the dashboard or the Lambda layers is not listed.

## Dashboard (`web/package.json`)

### Runtime

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [React](https://react.dev/) | 18.3.1 | MIT | UI framework |
| [React DOM](https://react.dev/) | 18.3.1 | MIT | React renderer for web browsers |
| [React Router](https://reactrouter.com/) (`react-router-dom`) | 7.18.2 | MIT | Client-side routing of the tabs and reports |
| [AWS Amplify](https://docs.amplify.aws/) | 6.20.0 | Apache-2.0 | Cognito authentication |
| [@aws-amplify/ui-react](https://ui.docs.amplify.aws/) | 6.15.5 | Apache-2.0 | Sign-in UI (`Authenticator`) |
| [Chart.js](https://www.chartjs.org/) | 4.5.1 | MIT | Charts |
| [react-chartjs-2](https://react-chartjs-2.js.org/) | 5.3.1 | MIT | React wrapper for Chart.js |
| [react-markdown](https://github.com/remarkjs/react-markdown) | 10.1.0 | MIT | Rendering Content Studio output |
| [remark-gfm](https://github.com/remarkjs/remark-gfm) | 4.0.1 | MIT | GitHub-flavored Markdown (tables, lists) |
| [remark-parse](https://github.com/remarkjs/remark/tree/main/packages/remark-parse) | 11.0.0 | MIT | Markdown parsing for the Word export |
| [unified](https://github.com/unifiedjs/unified) | 11.0.5 | MIT | Markdown processing pipeline of the Word export |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.13 | MPL-2.0 OR Apache-2.0 | HTML sanitization |
| [xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) | 1.2.0 | Apache-2.0 | Excel export |
| [docx](https://github.com/dolanmiu/docx) | 9.7.1 | MIT | Word export |
| [FileSaver.js](https://github.com/eligrey/FileSaver.js) (`file-saver`) | 2.0.5 | MIT | Saving exported files in the browser |

### Build

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [TypeScript](https://www.typescriptlang.org/) | 5.9.3 | Apache-2.0 | Type-checked source |
| [Vite](https://vitejs.dev/) | 8.2.1 | MIT | Build tool and dev server |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 6.0.5 | MIT | Vite plugin for React |
| [Tailwind CSS](https://tailwindcss.com/) | 3.4.19 | MIT | Utility-first CSS framework |
| [PostCSS](https://postcss.org/) | 8.5.26 | MIT | CSS transformation |
| [Autoprefixer](https://github.com/postcss/autoprefixer) | 10.5.4 | MIT | Vendor prefixes |
| [@types/react](https://www.npmjs.com/package/@types/react) | 18.3.31 | MIT | Type definitions for React |
| [@types/react-dom](https://www.npmjs.com/package/@types/react-dom) | 18.3.7 | MIT | Type definitions for React DOM |
| [@types/file-saver](https://www.npmjs.com/package/@types/file-saver) | 2.0.7 | MIT | Type definitions for FileSaver.js |

## Infrastructure (`package.json`)

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [AWS CDK library](https://aws.amazon.com/cdk/) (`aws-cdk-lib`) | 2.265.0 | Apache-2.0 | Infrastructure as code |
| [constructs](https://github.com/aws/constructs) | 10.8.1 | Apache-2.0 | CDK construct model |
| [AWS CDK CLI](https://aws.amazon.com/cdk/) (`aws-cdk`) | 2.1136.0 | Apache-2.0 | Synth and deploy |
| [TypeScript](https://www.typescriptlang.org/) | 5.9.3 | Apache-2.0 | CDK app language |

## Lambda functions (Python)

### Shared layer (`lambda/layer/requirements.txt`)

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [requests](https://requests.readthedocs.io/) | ≥2.31.0 | Apache-2.0 | HTTP calls to the AI engines, search providers and crawled pages |
| [beautifulsoup4](https://www.crummy.com/software/BeautifulSoup/) | ≥4.12.0 | MIT | HTML parsing |
| [tzdata](https://github.com/python/tzdata) | ≥2024.1 | Apache-2.0 | IANA time zone database for schedule validation |

OpenAI, Perplexity, Gemini and Claude (Anthropic API) and the web-search providers are called over their REST APIs with
`requests`, without vendor SDKs; internal model calls use Amazon Bedrock through boto3. The shared layer uses the boto3
provided by the Lambda runtime.

### Crawler layer (`lambda/crawler-layer/requirements.txt`)

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [bedrock-agentcore](https://github.com/aws/bedrock-agentcore-sdk-python) | 1.23.1 | Apache-2.0 | Bedrock AgentCore browser sessions |
| [Playwright](https://playwright.dev/python/) | 1.63.0 | Apache-2.0 | CDP client for the remote browser |
| [greenlet](https://github.com/python-greenlet/greenlet) | 3.5.6 | MIT AND PSF-2.0 | Playwright dependency |
| [pyee](https://github.com/jfhbrook/pyee) | 13.0.1 | MIT | Playwright dependency |
| [websockets](https://github.com/python-websockets/websockets) | 17.1 | BSD-3-Clause | Browser automation stream |
| [boto3](https://github.com/boto/boto3) | 1.43.98 | Apache-2.0 | AWS SDK for Python (bundled; AgentCore needs a newer SDK than the runtime ships) |
| [botocore](https://github.com/boto/botocore) | 1.43.98 | Apache-2.0 | boto3 core |
| [s3transfer](https://github.com/boto/s3transfer) | 0.19.2 | Apache-2.0 | boto3 dependency |
| [jmespath](https://github.com/jmespath/jmespath.py) | 1.1.0 | MIT | boto3 dependency |

## License compliance

The dependencies above use permissive licenses: MIT, Apache-2.0, BSD-3-Clause, PSF-2.0 (part of greenlet's
`MIT AND PSF-2.0`), and MPL-2.0 as one option of DOMPurify's dual license. DOMPurify is used under Apache-2.0.

This project itself is licensed under the **MIT No Attribution (MIT-0) License** (see [LICENSE](LICENSE)).

## License texts

- MIT No Attribution (MIT-0): https://opensource.org/license/mit-0
- MIT License: https://opensource.org/licenses/MIT
- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- BSD-3-Clause: https://opensource.org/licenses/BSD-3-Clause
- Python Software Foundation License 2.0: https://opensource.org/license/python-2-0
- Mozilla Public License 2.0: https://www.mozilla.org/en-US/MPL/2.0/
