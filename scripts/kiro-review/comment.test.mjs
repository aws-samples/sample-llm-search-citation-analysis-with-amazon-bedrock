import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  BANNER, MARKER, MAX_BODY, buildComment, containsSecret, extractReview, sanitize, verdictOf 
} from './comment.mjs'

const ESC = String.fromCharCode(27)
const REVIEW = '### Verdict: CONCERNS\n\nAdds a route.\n\n#### Blocking\n\nNone.'

test('the review starts at the last Verdict heading; tool chatter and ANSI codes before it are dropped', () => {
  const raw = `${ESC}[32mReading file: trusted/TENETS.md${ESC}[0m\n### Verdict: PASS (draft)\nthinking\n${REVIEW}\n`
  assert.equal(extractReview(raw), REVIEW)
  assert.equal(extractReview('no review here'), null)
})

test('the verdict is read from the heading, NONE without one', () => {
  assert.equal(verdictOf(REVIEW), 'CONCERNS')
  assert.equal(verdictOf('### Verdict: blocking\n'), 'BLOCKING')
  assert.equal(verdictOf(null), 'NONE')
})

test('sanitize escapes HTML, drops HTML comments and images, and breaks @-mentions', () => {
  const out = sanitize('<img src=x onerror=1><b>bold</b> ![pic](https://e.x/p.png) [site](https://e.x) [rel](lib/a.ts) @octocat a@b.c `@x`')
  assert.equal(out, '&lt;img src=x onerror=1>&lt;b>bold&lt;/b> pic [site](https://e.x) [rel](lib/a.ts) @\u200Boctocat a@b.c `@x`')
  assert.equal(sanitize('<scr<script>ipt>'), '&lt;scr&lt;script>ipt>')
  assert.equal(sanitize('a <!-- hidden --> b <!-- unclosed'), 'a  b ')
})

test('credentials are detected in their usual formats, and ordinary text is not', () => {
  assert.equal(containsSecret('key ksk_EXAMPLEexampleEXAMPLE0'), true)
  assert.equal(containsSecret(`token ghp_${'a'.repeat(36)}`), true)
  assert.equal(containsSecret(`id ${'AKIA'}${'ABCDEFGHIJKLMNOP'}`), true)
  assert.equal(containsSecret('-----BEGIN RSA PRIVATE KEY-----'), true)
  assert.equal(containsSecret(REVIEW), false)
})

test('the comment carries the marker, the sanitized review and a footer naming the commit and run', () => {
  const {
    verdict, body 
  } = buildComment(`${REVIEW} @someone`, {
    runUrl: 'https://github.com/o/r/actions/runs/1',
    headSha: '0123456789abcdef' 
  })
  assert.equal(verdict, 'CONCERNS')
  assert.ok(body.startsWith(`${MARKER}\n${BANNER}\n\n### Verdict: CONCERNS`))
  assert.match(body, /automated PR review done with Kiro CLI/)
  assert.match(body, /@\u200Bsomeone/)
  assert.match(body, /`0123456789ab`/)
  assert.match(body, /\[Run log\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)/)
})

test('a missing review becomes a notice, and a long one is truncated', () => {
  assert.match(buildComment('nothing').body, /did not return a review/)
  assert.equal(buildComment('nothing').verdict, 'NONE')
  const long = buildComment(`${REVIEW}\n${'x'.repeat(MAX_BODY * 2)}`).body
  assert.ok(long.length < MAX_BODY + 1000)
  assert.match(long, /review truncated/)
})
