export class AlertHookFailure extends Error {
  constructor(message = 'Private alert failure') {
    super(message);
    this.name = 'AlertHookFailure';
  }
}

export class AlertHookAbortError extends DOMException {
  constructor() {
    super('Alert request aborted', 'AbortError');
  }
}
