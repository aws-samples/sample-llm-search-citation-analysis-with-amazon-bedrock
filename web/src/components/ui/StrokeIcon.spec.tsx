import {
  describe, expect, it
} from 'vitest';
import { render } from '@testing-library/react';
import { StrokeIcon } from './StrokeIcon';

describe('StrokeIcon', () => {
  it('draws one path per d attribute, in order', () => {
    const { container } = render(<StrokeIcon paths={['M1 1h2', 'M3 3v4']} />);

    expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('d'))).toStrictEqual(['M1 1h2', 'M3 3v4']);
  });

  it('strokes every path 1.5 wide by default', () => {
    const { container } = render(<StrokeIcon paths={['M1 1h2']} />);

    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe('1.5');
  });
});
