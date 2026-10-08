import { useId } from 'react';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import { CodeBlock } from './CodeBlock';
import { CopyButton } from './CopyButton';

const DESCRIPTION = 'Ask Claude, ChatGPT, Kiro or Amazon Quick about your brand\'s AI visibility — they read this dashboard\'s data through a secure MCP connection.';

/** Commands from `docs/mcp.md`: deploy the MCP stack, then rebuild the dashboard so it knows the server URL. */
const DEPLOY_COMMANDS = 'npx cdk deploy CitationAnalysisMcpStack\n./scripts/deploy-web.sh';

function ServerUrlField({ url }: { readonly url: string }) {
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">MCP server URL</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="text"
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 p-2 font-mono text-sm"
        />
        <CopyButton text={url} label="MCP server URL" />
      </div>
    </div>
  );
}

function SignInNotes() {
  return (
    <div className="space-y-2 text-sm text-gray-600">
      <p>
        The first time, your assistant opens a sign-in page; use your dashboard email and password, then allow access.
        Your assistant only sees what your account can see.
      </p>
      <p>
        Starting an analysis run costs provider credit, so it is for admins only and always takes two steps: the assistant
        shows you an estimate and starts the run only after you confirm. Keyword research and content briefs work the same way.
      </p>
    </div>
  );
}

function NotDeployedNotice() {
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <p className="font-medium">The MCP server isn&apos;t deployed for this dashboard.</p>
      <p>
        An administrator can deploy it and then rebuild the dashboard, so this page shows the server URL and the client
        setup (npm run deploy does both):
      </p>
      <CodeBlock label="Deploy the MCP server" value={DEPLOY_COMMANDS} />
    </div>
  );
}

/** The page's header card: what the connection is, the server URL and how signing in works. */
export function ConnectionIntro({ url }: { readonly url: string | null }) {
  return (
    <PageHeaderCard title="Connect an AI assistant" description={DESCRIPTION}>
      {url === null ? <NotDeployedNotice /> : <ServerUrlField url={url} />}
      <SignInNotes />
    </PageHeaderCard>
  );
}
