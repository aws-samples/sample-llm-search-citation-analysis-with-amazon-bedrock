import { TestError } from '../../test/testError';

export function ThrowingComponent({ shouldThrow }: Readonly<{ shouldThrow: boolean }>) {
  if (shouldThrow) {
    throw new TestError('Test error message');
  }
  return <div>Child content</div>;
}
