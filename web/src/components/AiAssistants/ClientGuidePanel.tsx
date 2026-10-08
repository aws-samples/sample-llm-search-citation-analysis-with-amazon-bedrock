import { saveAs } from 'file-saver';
import { Button } from '../ui/Button';
import { CodeBlock } from './CodeBlock';
import {
  buildRedirectUrisCommand, type ClientCallback, type ClientGuide, type ConfigSnippet
} from './mcpClients';

function downloadSnippet(value: string, fileName: string) {
  // file-saver creates the object URL and revokes it once the download has started.
  saveAs(new Blob([value], { type: 'application/json' }), fileName);
}

function SnippetBlock({ snippet }: { readonly snippet: ConfigSnippet }) {
  const { downloadName } = snippet;
  const download = downloadName === undefined ? null : (
    <Button variant="secondary" size="sm" onClick={() => downloadSnippet(snippet.value, downloadName)}>
      {`Download ${downloadName}`}
    </Button>
  );
  return <CodeBlock label={snippet.label} value={snippet.value} actions={download} />;
}

function CallbackNote({ callback }: { readonly callback: ClientCallback }) {
  const urls = callback.urls.join(', ');
  if (callback.allowedByDefault) {
    return (
      <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
        {`Works out of the box: the MCP server allows this sign-in callback by default (${urls}).`}
      </p>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      <p>
        {`One-time admin step: sign-in only works once the MCP server allows this client's callback (${urls}). `}
        An administrator adds it when deploying the MCP stack. The value replaces the current list, so keep every callback already in use.
      </p>
      <CodeBlock label="Admin: allow the callback" value={buildRedirectUrisCommand(callback.urls)} />
    </div>
  );
}

/** The steps, values and sign-in callback of one client. */
export function ClientGuidePanel({ guide }: { readonly guide: ClientGuide }) {
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-600">
        {guide.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      {guide.snippets.map((snippet) => <SnippetBlock key={snippet.label} snippet={snippet} />)}
      <CallbackNote callback={guide.callback} />
      <ul className="list-disc space-y-1 pl-5 text-xs text-gray-500">
        {guide.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </div>
  );
}
