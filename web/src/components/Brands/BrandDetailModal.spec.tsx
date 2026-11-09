import {
  fireEvent, render, screen
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import { BrandDetailModal } from './BrandDetailModal';
import { buildAggregatedBrand } from '../../hooks/useBrandMentions-fixtures';
import { describeDialogContract } from '../../test/dialogContract';

vi.mock('./BrandOverviewTab', () => ({ BrandOverviewTab: () => <p>Overview body</p> }));
vi.mock('./ProviderResponsesTab', () => ({ ProviderResponsesTab: () => <p>Responses body</p> }));
vi.mock('../SelfReflection/SelfReflectionPanel', () => ({ SelfReflectionPanel: () => <p>Ranking body</p> }));

/** Renders the modal for a competitor brand and returns its `onClose` spy. */
function renderBrandModal(singleKeyword = true) {
  const onClose = vi.fn();
  render(
    <BrandDetailModal
      brand={buildAggregatedBrand({
        name: 'Hotel Coruña',
        classification: 'competitor',
        overall_rank: 2,
        parent_company: 'Coruña Group',
      })}
      providerData={[]}
      keyword="hotel coruna spa"
      singleKeyword={singleKeyword}
      onClose={onClose}
    />
  );
  return onClose;
}

describe('BrandDetailModal', () => {
  it('shows the classification, keyword, rank and parent company in the header', () => {
    renderBrandModal();

    expect(screen.getByText('Competitor')).toBeInTheDocument();
    expect(screen.getByText('hotel coruna spa').parentElement).toHaveTextContent('Rank #2');
    expect(screen.getByText('Parent: Coruña Group')).toBeInTheDocument();
  });

  it('switches to the ranking analysis tab', () => {
    renderBrandModal();

    fireEvent.click(screen.getByRole('tab', { name: 'Ranking Analysis' }));
    expect(screen.getByText('Ranking body')).toBeInTheDocument();
  });

  it('shows only the overview for a group or all-keywords scope', () => {
    renderBrandModal(false);

    expect({
      tabs: screen.queryAllByRole('tab').length,
      overview: screen.getByText('Overview body').textContent,
      label: screen.getByText('hotel coruna spa').parentElement?.textContent?.startsWith('Scope:'),
    }).toStrictEqual({
      tabs: 0,
      overview: 'Overview body',
      label: true,
    });
  });

  describeDialogContract({
    name: 'Hotel Coruña',
    render: renderBrandModal,
    closeButtons: ['Close'],
  });
});
