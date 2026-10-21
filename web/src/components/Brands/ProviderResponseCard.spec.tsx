import {
  describe, expect, it
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { ProviderResponseCard } from './ProviderResponseCard';
import type { ProviderBrandData } from '../../types';
import { buildAggregatedBrand } from '../../hooks/useBrandMentions-fixtures';

const BRAND = buildAggregatedBrand({ name: 'Hotel Sol' });

const SHORTENED_ANSWER = 'Hotel Sol en La Coruña ofrece spa. '.repeat(20);

const SHORTENED_PROVIDER = {
  provider: 'openai',
  timestamp: '2026-10-21T11:45:05Z',
  brands: [],
  response_preview: SHORTENED_ANSWER.slice(0, 200),
  full_response: SHORTENED_ANSWER,
  response_truncated: true,
  response_length: 15_000,
} satisfies ProviderBrandData;

function renderExpanded(provider: ProviderBrandData) {
  render(<ProviderResponseCard provider={provider} brand={BRAND} />);
  fireEvent.click(screen.getByRole('button', { name: /Expand Full Response/ }));
}

describe('ProviderResponseCard shortened answers', () => {
  it('says how much of a shortened answer is shown once it is expanded', () => {
    renderExpanded(SHORTENED_PROVIDER);

    expect(screen.getByText(/Answer shortened to its first 700 of 15,000 characters\./)).toBeInTheDocument();
  });

  it('shows no note for an answer the API sent whole', () => {
    renderExpanded({
      ...SHORTENED_PROVIDER,
      response_truncated: false,
    });

    expect(screen.queryByText(/Answer shortened/)).not.toBeInTheDocument();
  });

  it('shows no note while the answer is collapsed', () => {
    render(<ProviderResponseCard provider={SHORTENED_PROVIDER} brand={BRAND} />);

    expect(screen.queryByText(/Answer shortened/)).not.toBeInTheDocument();
  });
});
