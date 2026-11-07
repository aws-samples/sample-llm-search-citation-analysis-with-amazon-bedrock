#!/usr/bin/env node
/**
 * Turns the Kiro reviewer's raw output into the pull request comment `.github/workflows/kiro-review.yml` posts.
 *
 * The output is written by a model that read text the pull request's author controls, so it is treated as
 * untrusted: this keeps only the review (from its last `### Verdict:` line), strips ANSI codes, HTML and images,
 * breaks @-mentions so nobody is pinged, caps the length, and refuses to produce a comment at all
 * when the text looks like it contains a credential. GitHub also drops a job output that holds a masked secret, so
 * a leaked KIRO_API_KEY would be stopped twice.
 *
 * Usage: node scripts/kiro-review/comment.mjs <raw output> <comment.md>
 *   Prints `verdict=<PASS|CONCERNS|BLOCKING|NONE>` for $GITHUB_OUTPUT. Exit 1 when a credential was found.
 *   Env: REVIEW_RUN_URL (link to the run, added to the footer), REVIEW_HEAD_SHA (the reviewed commit).
 */
import {
  readFileSync, writeFileSync 
} from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MARKER = '<!-- kiro-review -->'
export const MAX_BODY = 60_000
const VERDICT = /^#{1,6}\s*Verdict:\s*(PASS|CONCERNS|BLOCKING)\b/im
// ANSI CSI and OSC sequences, as a terminal would print them (built from char codes: ESC 27, BEL 7).
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\))`, 'g')
// Credential formats that must never reach a public comment: Kiro API keys, GitHub tokens, AWS access key ids,
// private key blocks.
const SECRET_PATTERNS = [
  /\bksk_[A-Za-z0-9]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_\w{40,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/** True when the text holds something shaped like a credential. */
export function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

/** The review part of the raw output: from the last Verdict heading to the end, ANSI codes removed. */
export function extractReview(raw) {
  const text = raw.replace(ANSI, '').replaceAll('\r\n', '\n')
  const lines = text.split('\n')
  let start = -1
  lines.forEach((line, index) => {
    if (VERDICT.test(line)) start = index
  })
  return start === -1 ? null : lines.slice(start).join('\n').trim()
}

/** The verdict a review states, or NONE. */
export function verdictOf(review) {
  const match = review === null ? null : VERDICT.exec(review)
  return match === null ? 'NONE' : match[1].toUpperCase()
}

/** The text without HTML comments (`<!-- … -->`); an unclosed one runs to the end. */
function withoutHtmlComments(text) {
  let out = ''
  let from = 0
  for (let open = text.indexOf('<!--'); open !== -1; open = text.indexOf('<!--', from)) {
    out += text.slice(from, open)
    const close = text.indexOf('-->', open + 4)
    if (close === -1) return out
    from = close + 3
  }
  return out + text.slice(from)
}

/**
 * Markdown that cannot ping or embed: no HTML, no images, no @-mentions. Links stay: GitHub autolinks a bare URL
 * anyway, refuses `javascript:` targets, and the prompt asks for repository paths only.
 */
export function sanitize(markdown) {
  return withoutHtmlComments(markdown)
    .replaceAll(/<\/?[A-Za-z][^>]*>/g, '')
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/(^|[^\w`])@(?=[A-Za-z0-9])/g, '$1@\u200B')
}

/** The comment body for a raw output. */
export function buildComment(raw, {
  runUrl = '', headSha = '' 
} = {}) {
  const review = extractReview(raw)
  const verdict = verdictOf(review)
  const commit = headSha ? `\`${headSha.slice(0, 12)}\`` : 'this pull request'
  const runLink = runUrl ? ` [Run log](${runUrl})` : ''
  const note = `Kiro review of ${commit} against TENETS.md, README.md and CONTRIBUTING.md (\`scripts/kiro-review/\`). Advisory: a person decides.${runLink}`
  const footer = ['', '---', `<sub>${note}</sub>`].join('\n')
  let content
  if (review === null) {
    content = '### Verdict: none\n\nThe reviewer did not return a review in the expected format. See the run log.'
  } else {
    content = sanitize(review)
    if (content.length > MAX_BODY) content = `${content.slice(0, MAX_BODY)}\n\n_(review truncated)_`
  }
  return {
    verdict,
    body: `${MARKER}\n${content}\n${footer}\n` 
  }
}

function main(argv, env) {
  const [input, output] = argv
  if (!input || !output) {
    console.error('usage: comment.mjs <raw output> <comment.md>')
    return 2
  }
  const raw = readFileSync(input, 'utf8')
  if (containsSecret(raw)) {
    console.error('kiro-review: the review output looks like it contains a credential; nothing is posted')
    console.log('verdict=NONE')
    return 1
  }
  const {
    verdict, body 
  } = buildComment(raw, {
    runUrl: env.REVIEW_RUN_URL ?? '',
    headSha: env.REVIEW_HEAD_SHA ?? '' 
  })
  writeFileSync(output, body)
  console.log(`verdict=${verdict}`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2), process.env)
