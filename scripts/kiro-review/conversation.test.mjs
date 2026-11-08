import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { MARKER } from './comment.mjs'
import {
  MAX_ENTRIES, conversationMarkdown, entries, isOwnReview, roleOf,
} from './conversation.mjs'

const bot = {
  login: 'github-actions[bot]',
  type: 'Bot' 
}
const own = (body, at) => ({
  user: bot,
  body: `${MARKER}\n${body}`,
  created_at: at 
})
const comment = (login, association, body, at) => ({
  user: {
    login,
    type: 'User' 
  },
  author_association: association,
  body,
  created_at: at 
})

test('roles: the reviewer\'s own review, maintainers, bots and contributors are told apart', () => {
  assert.equal(roleOf(own('x')), 'kiro, your previous review')
  assert.equal(roleOf({
    user: bot,
    body: 'deploy preview' 
  }), 'bot')
  assert.equal(roleOf({
    user: { login: 'github-advanced-security[bot]' },
    body: 'x' 
  }), 'bot')
  assert.equal(roleOf(comment('ana', 'MEMBER', 'x')), 'maintainer')
  assert.equal(roleOf(comment('bob', 'NONE', 'x')), 'contributor')
  assert.equal(isOwnReview({
    user: { login: 'eve' },
    body: `${MARKER}\nfake` 
  }), false)
})

test('comments, reviews and inline comments are merged oldest first; empty ones are dropped', () => {
  const list = entries(
    [comment('ana', 'OWNER', 'second', '2026-11-08T02:00:00Z'), comment('ana', 'OWNER', '  ', '2026-11-08T03:00:00Z')],
    [{
      user: { login: 'ana' },
      author_association: 'OWNER',
      state: 'APPROVED',
      body: 'first',
      submitted_at: '2026-11-08T01:00:00Z' 
    }],
    [{
      user: { login: 'bob' },
      author_association: 'NONE',
      path: 'lib/a.ts',
      line: 7,
      body: 'third',
      created_at: '2026-11-08T04:00:00Z' 
    }],
  )
  assert.deepEqual(list.map((e) => [e.kind, e.body]), [['review (approved)', 'first'], ['comment', 'second'], ['inline comment on lib/a.ts:7', 'third']])
})

test('the Markdown names author and role, strips the marker, and keeps the reviewer\'s last review', () => {
  const md = conversationMarkdown([
    own('### Verdict: CONCERNS\n- bundling', '2026-11-08T01:00:00Z'),
    comment('ana', 'OWNER', 'Accepted as bundled.', '2026-11-08T02:00:00Z'),
  ], [], [])
  assert.match(md, /## comment by github-actions\[bot\] \(kiro, your previous review\)/)
  assert.match(md, /## comment by ana \(maintainer\), 2026-11-08T02:00:00Z\n\nAccepted as bundled\./)
  assert.doesNotMatch(md, /kiro-review -->/)
  assert.equal(conversationMarkdown([], [], []), 'No comments or reviews on this pull request yet.\n')
})

test('a long conversation keeps the newest entries and the reviewer\'s last review, and says what it left out', () => {
  const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => comment('bob', 'NONE', `c${i}`, `2026-11-08T${String(i % 24).padStart(2, '0')}:${String(i).padStart(2, '0')}:00Z`))
  const md = conversationMarkdown([own('old review', '2026-11-07T00:00:00Z'), ...many], [], [])
  assert.match(md, /^\(5 older entries omitted\)/)
  assert.match(md, /old review/)
})
