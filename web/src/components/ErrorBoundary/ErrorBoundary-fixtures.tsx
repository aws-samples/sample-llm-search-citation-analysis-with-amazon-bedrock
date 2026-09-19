export class TestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

export function ThrowingComponent({ shouldThrow }: Readonly<{ shouldThrow: boolean }>) {
  if (shouldThrow) {
    throw new TestError('Test error message');
  }
  return <div>Child content</div>;
}
