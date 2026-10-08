import {
  ASSISTANT_INSTRUCTIONS, EXAMPLE_PROMPTS, INSTRUCTION_TARGETS, MCP_TOOLS, TOOL_ACCESS_LABELS, type ToolAccess
} from './assistantGuidance';
import { CodeBlock } from './CodeBlock';
import { CopyButton } from './CopyButton';
import { SectionCard } from './SectionCard';

const ACCESS_BADGE: Record<ToolAccess, string> = {
  read: 'bg-gray-100 text-gray-700',
  write: 'bg-blue-50 text-blue-700',
  spend: 'bg-amber-50 text-amber-800',
  'admin-spend': 'bg-red-50 text-red-700',
};

const TABLE_HEADERS = ['Tool', 'What it does', 'Access'];
export function ExamplePrompts() {
  return (
    <SectionCard title="What you can ask" description="Once connected, try questions like these.">
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <li key={prompt} className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-gray-700">
            <span>{prompt}</span>
            <CopyButton text={prompt} label={`prompt: ${prompt}`} />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function AssistantInstructions() {
  return (
    <SectionCard
      title="Teach your assistant"
      description="Paste these instructions where your assistant keeps standing instructions, so it picks the right tools, quotes only real figures and always asks before spending credit."
    >
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-600">
        {INSTRUCTION_TARGETS.map((target) => <li key={target}>{target}</li>)}
      </ul>
      <CodeBlock label="Assistant instructions" value={ASSISTANT_INSTRUCTIONS} wrap />
    </SectionCard>
  );
}

export function ToolsTable() {
  return (
    <SectionCard
      title="Tools"
      description="What the MCP server offers. Everything runs as you, with your dashboard permissions. User management, provider API keys and settings, brand configuration and schedule changes, and deletes stay in the dashboard."
    >
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {TABLE_HEADERS.map((header) => (
                <th key={header} scope="col" className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {MCP_TOOLS.map((tool) => (
              <tr key={tool.name}>
                <td className="px-4 py-2 font-mono text-xs text-gray-900">{tool.name}</td>
                <td className="px-4 py-2 text-gray-600">{tool.description}</td>
                <td className="whitespace-nowrap px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACCESS_BADGE[tool.access]}`}>
                    {TOOL_ACCESS_LABELS[tool.access]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
