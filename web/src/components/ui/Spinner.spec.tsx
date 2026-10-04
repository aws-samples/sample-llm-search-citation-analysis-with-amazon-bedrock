import type { ComponentProps } from 'react';
import { render } from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { Spinner } from './Spinner';

function renderSpinnerSvg(props: ComponentProps<typeof Spinner> = {}) {
  return render(<Spinner {...props} />).container.querySelector('svg');
}

describe('Spinner', () => {
  it.each([
    {
      title: 'renders with default medium size when no size prop provided',
      props: {},
      classes: ['h-6', 'w-6'],
    },
    {
      title: 'renders small size when size is sm',
      props: { size: 'sm' },
      classes: ['h-4', 'w-4'],
    },
    {
      title: 'renders large size when size is lg',
      props: { size: 'lg' },
      classes: ['h-8', 'w-8'],
    },
  ] as const)('$title', ({
    props, classes
  }) => {
    expect(renderSpinnerSvg(props)).toHaveClass(...classes);
  });

  it('applies custom className when provided', () => {
    expect(renderSpinnerSvg({ className: 'text-blue-500' })).toHaveClass('text-blue-500');
  });

  it('has aria-hidden attribute for accessibility', () => {
    expect(renderSpinnerSvg()).toHaveAttribute('aria-hidden', 'true');
  });
});
