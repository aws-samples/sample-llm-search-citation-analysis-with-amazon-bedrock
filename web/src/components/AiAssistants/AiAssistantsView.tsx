import {
  AssistantInstructions, ExamplePrompts, ToolsTable 
} from './AssistantGuidanceSections';
import { ClientPicker } from './ClientPicker';
import { ConnectionIntro } from './ConnectionIntro';
import {
  isMcpDeployed, readMcpConfig 
} from './mcpConfig';
import { SectionCard } from './SectionCard';

/**
 * "Connect an AI assistant": how to reach this dashboard's MCP server from
 * Claude, ChatGPT, Kiro, Amazon Quick and other clients. The server URL and
 * client id are the MCP stack outputs baked in at build time; without them the
 * page says the server is not deployed and shows no client setup.
 */
export function AiAssistantsView() {
  const config = readMcpConfig();
  const deployed = isMcpDeployed(config);

  return (
    <div className="space-y-6">
      <ConnectionIntro url={deployed ? config.url : null} />
      {deployed && (
        <SectionCard title="Set up your assistant" description="Pick your assistant and follow the steps. Every value has its own Copy button.">
          <ClientPicker config={config} />
        </SectionCard>
      )}
      <ExamplePrompts />
      <AssistantInstructions />
      <ToolsTable />
    </div>
  );
}
