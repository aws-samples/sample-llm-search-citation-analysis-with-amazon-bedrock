# Third-Party Licenses

This document lists all third-party open source software used in the Citation Analysis System, along with their licenses and attributions.

## Frontend Dependencies (TypeScript/React)

### Core Framework

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [React](https://react.dev/) | 18.3.1 | MIT | UI framework for building the dashboard |
| [React DOM](https://react.dev/) | 18.3.1 | MIT | React renderer for web browsers |
| [TypeScript](https://www.typescriptlang.org/) | 5.9.3 | Apache-2.0 | Type-safe JavaScript for frontend code |

### Build Tools

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [Vite](https://vitejs.dev/) | 5.4.21 | MIT | Fast build tool and dev server |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.7.0 | MIT | Vite plugin for React support |
| [Terser](https://terser.org/) | 5.44.1 | BSD-2-Clause | JavaScript minifier for production builds |

### Styling

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [Tailwind CSS](https://tailwindcss.com/) | 3.4.18 | MIT | Utility-first CSS framework |
| [PostCSS](https://postcss.org/) | 8.5.6 | MIT | CSS transformation tool |
| [Autoprefixer](https://github.com/postcss/autoprefixer) | 10.4.22 | MIT | PostCSS plugin for vendor prefixes |

### Authentication

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [AWS Amplify](https://docs.amplify.aws/) | 6.15.9 | Apache-2.0 | AWS SDK for authentication and API calls |
| [@aws-amplify/ui-react](https://ui.docs.amplify.aws/) | 6.13.2 | Apache-2.0 | Pre-built React components for authentication UI |

### Data Visualization

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [Chart.js](https://www.chartjs.org/) | 4.5.1 | MIT | JavaScript charting library |
| [react-chartjs-2](https://react-chartjs-2.js.org/) | 5.3.1 | MIT | React wrapper for Chart.js |

### Data Export

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) | 1.2.0 | Apache-2.0 | Excel file generation with styling for data export |

### Security

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.3.1 | MPL-2.0 OR Apache-2.0 | HTML sanitization to prevent XSS attacks |

### Type Definitions

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [@types/react](https://www.npmjs.com/package/@types/react) | 18.3.26 | MIT | TypeScript type definitions for React |
| [@types/react-dom](https://www.npmjs.com/package/@types/react-dom) | 18.3.7 | MIT | TypeScript type definitions for React DOM |
| [@types/dompurify](https://www.npmjs.com/package/@types/dompurify) | 3.0.5 | MIT | TypeScript type definitions for DOMPurify |

## Backend Dependencies (Python)

### AWS SDK

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html) | ≥1.34.0 | Apache-2.0 | AWS SDK for Python (DynamoDB, S3, Secrets Manager, Bedrock) |

### AI Provider SDKs

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [openai](https://github.com/openai/openai-python) | ≥1.10.0 | Apache-2.0 | OpenAI API client for GPT-4o with web search |
| [google-generativeai](https://github.com/google/generative-ai-python) | ≥0.3.0 | Apache-2.0 | Google Gemini API client with grounding |

### HTTP and Web Scraping

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [requests](https://requests.readthedocs.io/) | ≥2.31.0 | Apache-2.0 | HTTP library for API calls and web requests |
| [httpx](https://www.python-httpx.org/) | ≥0.28.0 | BSD-3-Clause | Async HTTP client for concurrent AI provider requests |
| [anyio](https://anyio.readthedocs.io/) | ≥4.0.0 | MIT | Async I/O library (dependency of httpx) |
| [beautifulsoup4](https://www.crummy.com/software/BeautifulSoup/) | ≥4.12.0 | MIT | HTML parsing for web content extraction |

## Infrastructure (AWS CDK)

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [AWS CDK](https://aws.amazon.com/cdk/) | 2.x | Apache-2.0 | Infrastructure as code framework |

## AWS Services Used

The following AWS services are used by this application. These are not third-party libraries but AWS-managed services:

- **AWS Lambda** - Serverless compute for Python functions
- **Amazon DynamoDB** - NoSQL database for search results and citations
- **Amazon S3** - Object storage for raw responses and web hosting
- **Amazon CloudFront** - CDN for dashboard delivery
- **AWS Step Functions** - Workflow orchestration
- **Amazon API Gateway** - REST API endpoints
- **AWS Secrets Manager** - Secure storage for API keys
- **Amazon Cognito** - User authentication and authorization
- **AWS WAF** - Web application firewall protection
- **Amazon Bedrock** - Claude Sonnet for brand extraction
- **Amazon EventBridge** - Scheduled analysis runs

## License Compliance

All third-party libraries used in this project are licensed under permissive open source licenses:
- **MIT License** - Permissive license allowing commercial use
- **Apache License 2.0** - Permissive license with patent grant
- **BSD-2-Clause / BSD-3-Clause** - Permissive BSD licenses
- **MPL-2.0** - Mozilla Public License 2.0 (file-level copyleft, compatible with Apache-2.0)

DOMPurify is dual-licensed (MPL-2.0 OR Apache-2.0), and we use it under the Apache-2.0 license for consistency with this project.

This project itself is licensed under the **MIT No Attribution (MIT-0) License**.

## Acknowledgments

We are grateful to the open source community and the maintainers of these libraries for making their work available.

## License Texts

Full license texts for each license type can be found at:
- MIT No Attribution (MIT-0): https://opensource.org/license/mit-0
- MIT License: https://opensource.org/licenses/MIT
- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- BSD-2-Clause: https://opensource.org/licenses/BSD-2-Clause
- BSD-3-Clause: https://opensource.org/licenses/BSD-3-Clause

