import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import type { Keyword } from '../../types';
import { TabContent } from './TabContent';
import { buildTabContentProps } from './TabContent-fixtures';

vi.mock('../ContentStudio', () => ({
  ContentStudioView: ({ keywords }: { keywords: Keyword[] }) => (
    <div>Content Studio keywords: {keywords.map((keyword) => keyword.keyword).join(', ')}</div>
  ),
}));

describe('TabContent content studio wiring', () => {
  it('passes the existing dashboard keywords to Content Studio', async () => {
    render(<TabContent {...buildTabContentProps()} />);

    expect(await screen.findByText('Content Studio keywords: Alpha keyword')).toBeInTheDocument();
  });
});
