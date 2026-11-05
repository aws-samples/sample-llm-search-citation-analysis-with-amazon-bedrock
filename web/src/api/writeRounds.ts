/**
 * Bulk writes the API finishes over several requests.
 *
 * A keyword-group delete, a membership change and a promotion stop when the
 * request's time budget runs out and say what is left (`pending_members`,
 * `pending`, `pending_keywords`, each with `truncated: true`). Every one of
 * those writes is idempotent, so the client sends the rest again, at most
 * `MAX_WRITE_ROUNDS` requests per write.
 */

/** Most requests one write sends while the server answers that part of it is still pending. */
export const MAX_WRITE_ROUNDS = 10;

/**
 * The server still reported part of a write pending after `MAX_WRITE_ROUNDS`
 * requests. What was written is stored; `message` is written for the user.
 */
export class IncompleteWriteError extends Error {
  readonly pendingCount: number;

  constructor(message: string, pendingCount: number) {
    super(message);
    this.name = 'IncompleteWriteError';
    this.pendingCount = pendingCount;
  }
}
