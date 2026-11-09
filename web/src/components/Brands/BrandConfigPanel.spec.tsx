import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { BrandConfigPanel } from './BrandConfigPanel';
import { describeDialogContract } from '../../test/dialogContract';

vi.mock('./BrandConfigContent', () => ({
  BrandConfigContent: ({ onSaveComplete }: { onSaveComplete?: () => void }) => (
    <button onClick={onSaveComplete}>Save configuration</button>
  ),
}));

/** Renders the panel with no stored configuration and returns its `onClose` spy. */
function renderConfigPanel() {
  const onClose = vi.fn();
  render(<BrandConfigPanel config={null} presets={null} loading={false} onSave={vi.fn()} onClose={onClose} />);
  return onClose;
}

describe('BrandConfigPanel', () => {
  it('shows the configuration form in a scrolling body under the header', () => {
    renderConfigPanel();

    expect(screen.getByRole('heading', { name: 'Brand tracking' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save configuration' }).closest('.overflow-y-auto')).not.toBeNull();
  });

  describeDialogContract({
    name: 'Brand tracking',
    render: renderConfigPanel,
    closeButtons: ['Save configuration'],
  });
});
