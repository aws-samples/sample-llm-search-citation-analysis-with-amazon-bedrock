import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  BANNER, MARKER, MAX_BODY, buildIssueComment, isTriageReply, parseReply, threadMarkdown,
} from './issue.mjs'

const ISSUE = {
  number: 7,
  title: 'Add a Mistral provider',
  body: 'Please track Le Chat.',
  user: { login: 'alice' },
  labels: [{ name: 'enhancement' }],
}
const reply = (body) => ({
  user: { login: 'github-actions[bot]' },
  body: `${MARKER}\n${body}` 
})

test('a triage reply is the bot comment that starts with the marker, nothing else', () => {
  assert.equal(isTriageReply(reply('x')), true)
  assert.equal(isTriageReply({
    user: { login: 'alice' },
    body: `${MARKER}\nfake` 
  }), false)
  assert.equal(isTriageReply({
    user: { login: 'github-actions[bot]' },
    body: 'other bot comment' 
  }), false)
})

test('the thread holds the issue, its labels and the comments in order, with earlier replies marked [kiro]', () => {
  const md = threadMarkdown(ISSUE, [reply('Which market?'), {
    user: { login: 'alice' },
    body: 'France.' 
  }])
  assert.match(md, /^# Issue #7: Add a Mistral provider$/m)
  assert.match(md, /^Labels: enhancement$/m)
  assert.ok(md.indexOf('## Comment by [kiro]') < md.indexOf('## Comment by alice'))
  assert.doesNotMatch(md, /kiro-issue-triage/)
})

test('the thread caps a long body and keeps only the newest comments', () => {
  const comments = Array.from({ length: 35 }, (_, i) => ({
    user: { login: 'bob' },
    body: `c${i}` 
  }))
  const md = threadMarkdown({
    ...ISSUE,
    body: 'x'.repeat(MAX_BODY + 10) 
  }, comments)
  assert.match(md, /\[truncated at 20000 characters\]/)
  assert.match(md, /\(5 older comments omitted\)/)
  assert.doesNotMatch(md, /^c4$/m)
  assert.match(md, /^c34$/m)
})

test('a reply is parsed into label, tenet judgment and text', () => {
  const raw = 'Reading files...\nLABEL: Enhancement\nTENETS: needs-alignment\n---\n### What you asked\n\nA provider.\n---\nmore'
  assert.deepEqual(parseReply(raw), {
    label: 'enhancement',
    tenets: 'needs-alignment',
    reply: '### What you asked\n\nA provider.\n---\nmore' 
  })
})

test('the tenet judgment only applies to enhancements; unknown labels and empty replies are rejected', () => {
  assert.equal(parseReply('LABEL: bug\nTENETS: conflicts\n---\nSteps?').tenets, 'n/a')
  assert.equal(parseReply('LABEL: urgent\n---\ntext'), null)
  assert.equal(parseReply('LABEL: bug\n---\n'), null)
  assert.equal(parseReply('no format at all'), null)
})

test('the comment opens with the banner, is sanitized and names the label and judgment', () => {
  const body = buildIssueComment({
    label: 'enhancement',
    tenets: 'conflicts',
    reply: 'Hi @alice <b>x</b>' 
  })
  assert.ok(body.startsWith(`${MARKER}\n${BANNER}\n\n`))
  assert.match(body, /@\u200Balice &lt;b>x&lt;\/b>/)
  assert.match(body, /Triage: \*\*enhancement\*\* · Tenets: \*\*conflicts\*\*/)
  assert.match(buildIssueComment(null), /did not produce a usable answer/)
})

test('a reply wrapped in a code fence or with bold keys still parses', () => {
  const raw = 'Done.\n```\n**LABEL:** question\n**TENETS:** n/a\n---\nSee README.md, "Deployment".\n```\n'
  assert.deepEqual(parseReply(raw), {
    label: 'question',
    tenets: 'n/a',
    reply: 'See README.md, "Deployment".' 
  })
})
