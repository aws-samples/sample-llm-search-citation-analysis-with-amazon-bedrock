import {
  useId, useState, type KeyboardEvent
} from 'react';
import { ClientGuidePanel } from './ClientGuidePanel';
import {
  MCP_CLIENTS, type McpClientKey 
} from './mcpClients';
import type { McpConfig } from './mcpConfig';
import { nextTabIndex } from './tabNavigation';

const SELECTED_TAB = 'border-gray-900 bg-gray-900 text-white';
const IDLE_TAB = 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50';

/** A tab per assistant (arrow keys, Home and End move between them) and the selected one's guide. */
export function ClientPicker({ config }: { readonly config: McpConfig }) {
  const [selected, setSelected] = useState<McpClientKey>(MCP_CLIENTS[0].id);
  const baseId = useId();
  const tabId = (id: McpClientKey) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;
  const selectedIndex = MCP_CLIENTS.findIndex((client) => client.id === selected);
  const client = MCP_CLIENTS[selectedIndex];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(event.key, selectedIndex, MCP_CLIENTS.length);
    if (next === null) return;
    event.preventDefault();
    const target = MCP_CLIENTS[next].id;
    setSelected(target);
    document.getElementById(tabId(target))?.focus();
  };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="AI assistant" className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
        {MCP_CLIENTS.map(({
          id, label 
        }) => {
          const isSelected = id === selected;
          return (
            <button
              key={id}
              id={tabId(id)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={panelId}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(id)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${isSelected ? SELECTED_TAB : IDLE_TAB}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(selected)} tabIndex={0} className="focus:outline-none">
        <ClientGuidePanel guide={client.guide(config)} />
      </div>
    </div>
  );
}
