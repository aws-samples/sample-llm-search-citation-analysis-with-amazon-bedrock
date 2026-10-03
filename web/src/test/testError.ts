/** A plain error a spec throws or rejects with; specs may not throw the generic `Error`. */
export class TestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}
