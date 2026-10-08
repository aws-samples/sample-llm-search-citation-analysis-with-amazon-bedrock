import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { saveAs } from 'file-saver';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { AiAssistantsView } from './AiAssistantsView';
import { readMcpConfig } from './mcpConfig';
import {
  FAKE_MCP_CONFIG, UNDEPLOYED_MCP_CONFIG 
} from './mcpConfig-fixtures';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
vi.mock('./mcpConfig', async (importOriginal) => ({
  ...await importOriginal<typeof import('./mcpConfig')>(),
  readMcpConfig: vi.fn(),
}));

function renderView() {
  const user = userEvent.setup();
  render(<AiAssistantsView />);
  return user;
}

function getTabElement(name: string) {
  return screen.getByRole('tab', { name });
}

async function renderGuide(tabName: string) {
  const user = renderView();
  await user.click(getTabElement(tabName));
  return user;
}

describe('AiAssistantsView when the MCP server is deployed', () => {
  beforeEach(() => {
    vi.mocked(readMcpConfig).mockReturnValue(FAKE_MCP_CONFIG);
  });

  it('shows the server URL in a read-only field', () => {
    renderView();

    const field = screen.getByLabelText('MCP server URL');

    expect(field).toHaveValue('https://d111example.cloudfront.net/mcp');
    expect(field).toHaveAttribute('readonly');
  });

  it('copies the server URL and announces it was copied', async () => {
    const user = renderView();

    await user.click(screen.getByRole('button', { name: 'Copy MCP server URL' }));

    await expect(navigator.clipboard.readText()).resolves.toBe('https://d111example.cloudfront.net/mcp');
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('opens on the Claude guide with its admin callback step', () => {
    renderView();

    expect(getTabElement('Claude (claude.ai / Desktop)')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('https://claude.ai/api/mcp/auth_callback');
  });

  it.each([
    ['{ArrowRight}', 'Claude Code', 'claude mcp add --transport http citation-analysis https://d111example.cloudfront.net/mcp'],
    ['{ArrowLeft}', 'Other / Codex', 'OpenAI Codex CLI is not supported yet'],
    ['{End}', 'Other / Codex', 'OpenAI Codex CLI is not supported yet'],
  ])('moves focus with %s from the first tab to the %s guide', async (key, tabName, panelText) => {
    const user = await renderGuide('Claude (claude.ai / Desktop)');

    await user.keyboard(key);

    expect(getTabElement(tabName)).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent(panelText);
  });

  it('says the Claude Code callback works without an admin step', async () => {
    await renderGuide('Claude Code');

    expect(screen.getByRole('tabpanel')).toHaveTextContent('Works out of the box');
  });

  it('downloads the Kiro configuration as mcp.json', async () => {
    const user = await renderGuide('Kiro');

    await user.click(screen.getByRole('button', { name: 'Download mcp.json' }));

    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'mcp.json');
  });

  it('lists the analysis run tools as admin only', () => {
    renderView();

    const row = screen.getByRole('cell', { name: 'estimate_run → start_run' }).closest('tr');

    expect(row).toHaveTextContent('Admin only, spends credit');
  });
});

describe('AiAssistantsView when the MCP server is not deployed', () => {
  beforeEach(() => {
    vi.mocked(readMcpConfig).mockReturnValue(UNDEPLOYED_MCP_CONFIG);
  });

  it('says the MCP server is not deployed and shows the deploy command', () => {
    renderView();

    expect(screen.getByText('The MCP server isn\'t deployed for this dashboard.')).toBeInTheDocument();
    expect(screen.getByText(/npx cdk deploy CitationAnalysisMcpStack/)).toBeInTheDocument();
  });

  it('shows no server URL and no client setup', () => {
    renderView();

    expect(screen.queryByLabelText('MCP server URL')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
