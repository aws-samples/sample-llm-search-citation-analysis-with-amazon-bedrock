import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import {
  CompactNumber, PositionBadge, ScoreChip, UrlCell, positionTone, scoreTone
} from './tableCells';

describe('positionTone', () => {
  it.each([
    [1, 'green'],
    [3, 'green'],
    [4, 'blue'],
    [10, 'blue'],
    [11, 'amber'],
    [20, 'amber'],
    [21, 'neutral'],
  ] as const)('gives position %i the %s tone', (position, tone) => {
    expect(positionTone(position)).toBe(tone);
  });
});

describe('scoreTone', () => {
  it.each([
    [0, 'green'],
    [29, 'green'],
    [30, 'amber'],
    [69, 'amber'],
    [70, 'red'],
    [100, 'red'],
  ] as const)('gives score %i the %s tone', (score, tone) => {
    expect(scoreTone(score)).toBe(tone);
  });
});

describe('unknown values', () => {
  it.each([
    ['PositionBadge', <PositionBadge key="position" position={null} />],
    ['UrlCell', <UrlCell key="url" url={null} />],
    ['CompactNumber', <CompactNumber key="number" value={null} />],
  ])('%s shows a dash', (_component, element) => {
    render(element);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('PositionBadge', () => {
  it('shows the position with its default tooltip', () => {
    render(<PositionBadge position={4} />);

    expect(screen.getByText('4')).toHaveAttribute('title', 'Position 4');
  });

});

describe('ScoreChip', () => {
  it('rounds the score and names it in the tooltip', () => {
    render(<ScoreChip value={39.6} label="Spam score" />);

    expect(screen.getByText('40').parentElement).toHaveAttribute('title', 'Spam score: 40 / 100');
  });

  it('keeps a zero score distinct from an unknown one', () => {
    render(<><ScoreChip value={0} label="Spam score" /><ScoreChip value={null} label="Spam score" /></>);

    expect([screen.getByText('0').textContent, screen.getByTitle('Spam score unknown').textContent]).toStrictEqual(['0', '—']);
  });
});

describe('CompactNumber', () => {
  it('abbreviates a large count with the exact figure as tooltip', () => {
    render(<CompactNumber value={1_234_567} />);

    expect(screen.getByText('1.2M')).toHaveAttribute('title', '1,234,567');
  });

  it('sets no tooltip when nothing was abbreviated', () => {
    render(<CompactNumber value={950} />);

    expect(screen.getByText('950')).not.toHaveAttribute('title');
  });

  it('abbreviates currency when asked', () => {
    render(<CompactNumber value={12_345_678} currency />);

    expect(screen.getByText('$12.3M')).toHaveAttribute('title', '$12,345,678.00');
  });
});

describe('UrlCell', () => {
  it.each([
    ['opens in a new tab', 'target', '_blank'],
    ['gives the new tab no opener', 'rel', 'noopener noreferrer'],
    ['keeps the full URL as the tooltip of the shortened text', 'title', 'https://example.com/a/very/long/path'],
  ])('links an http(s) URL that %s', (_case, attribute, value) => {
    render(<UrlCell url="https://example.com/a/very/long/path" text="/a/very/long/path" />);

    expect(screen.getByRole('link', { name: '/a/very/long/path' })).toHaveAttribute(attribute, value);
  });

  it('shows a non-http URL as text, never as a link', () => {
    render(<UrlCell url="javascript:alert(1)" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

});
