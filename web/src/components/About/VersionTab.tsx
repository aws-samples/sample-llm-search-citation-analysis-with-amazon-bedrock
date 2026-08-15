const GITHUB_REPO_URL = 'https://github.com/aws-samples/sample-llm-search-citation-analysis-with-amazon-bedrock';

const GitHubIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

export function VersionTab() {
  const appVersion = import.meta.env.VITE_APP_VERSION ?? 'dev';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Application Version</h3>
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Currently deployed build</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">v{appVersion}</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          The version follows the <code className="bg-gray-100 px-1 rounded">web/package.json</code> version
          and is bumped whenever a feature set is merged or deployed.
        </p>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Source Code</h3>
        <p className="text-sm text-gray-600 mb-3">
          This project is open source and maintained in the AWS Samples organization on GitHub.
          Releases, issues, and pull requests all live there.
        </p>
        <div className="flex flex-col gap-2">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 transition-colors"
          >
            <GitHubIcon />
            GitHub repository
          </a>
          <a
            href={`${GITHUB_REPO_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 transition-colors"
          >
            <GitHubIcon />
            Report an issue or request a feature
          </a>
        </div>
      </div>
    </div>
  );
}
