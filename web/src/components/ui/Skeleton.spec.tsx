import {
  render, screen
} from '@testing-library/react';
import {
  describe, it, expect
} from 'vitest';
import {
  Skeleton, SkeletonCards, SkeletonLines, SkeletonPage, SkeletonRegion, SkeletonTable
} from './Skeleton';

describe('Skeleton', () => {
  it.each([
    ['aria-hidden', 'true'],
    ['class', 'skeleton h-4 w-32'],
  ])('renders the placeholder block with %s="%s"', (attribute, value) => {
    const { container } = render(<Skeleton className="h-4 w-32" />);

    expect(container.firstElementChild).toHaveAttribute(attribute, value);
  });
});

describe('SkeletonRegion', () => {
  it('announces its label as a busy status', () => {
    render(<SkeletonRegion label="Loading users"><Skeleton /></SkeletonRegion>);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('Loading users');
  });
});

describe('SkeletonLines', () => {
  it('renders one bar per requested line', () => {
    const { container } = render(<SkeletonLines lines={5} />);

    expect(container.querySelectorAll('.skeleton')).toHaveLength(5);
  });
});

describe('SkeletonTable', () => {
  it('renders rows times columns cell bars', () => {
    const { container } = render(<SkeletonTable rows={3} columns={4} />);

    expect(container.querySelectorAll('.skeleton')).toHaveLength(12);
  });

  it('gives each row the requested height', () => {
    const { container } = render(<SkeletonTable rows={2} rowClassName="h-16" />);

    expect(container.querySelectorAll('.h-16')).toHaveLength(2);
  });
});

describe('SkeletonCards', () => {
  it('renders the requested number of cards', () => {
    const { container } = render(<SkeletonCards count={3} cardClassName="h-40" />);

    expect(container.querySelectorAll('.h-40')).toHaveLength(3);
  });
});

describe('SkeletonPage', () => {
  it('announces the default page loading label', () => {
    render(<SkeletonPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
  });
});
