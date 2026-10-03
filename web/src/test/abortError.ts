/**
 * The rejection of an aborted request, as `isAbortError` sees it: an `Error`
 * named `AbortError`. (jsdom's own `DOMException` is a cross-realm class here
 * and fails `instanceof Error`, unlike a browser's.)
 */
export class TestAbortError extends Error {
  constructor() {
    super('The operation was aborted.');
    this.name = 'AbortError';
  }
}
