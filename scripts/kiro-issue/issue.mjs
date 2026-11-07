#!/usr/bin/env node
/**
 * The data side of `.github/workflows/kiro-issue-triage.yml`: it turns an issue and its comments (GitHub API JSON)
 * into the `data/issue.md` the Kiro triager reads, and turns the triager's raw output into the label, the tenet
 * judgment and the comment the workflow posts.
 *
 * Both directions treat their input as untrusted: issue text comes from anyone on the internet, and the triager's
 * output is a model's answer to that text. Inputs are capped in size (they cost credits), and the reply goes
 * through the same checks as the pull request review (scripts/kiro-review/comment.mjs): no credential-shaped text,
 * HTML escaped, images dropped, @-mentions broken.
 *
 * Usage:
 *   node scripts/kiro-issue/issue.mjs thread <issue.json> <comments.json> <issue.md>
 *     prints `followups=<n>`: how many triage replies the issue already has
 *   node scripts/kiro-issue/issue.mjs reply <raw output> <comment.md>
 *     prints `label=<label>` and `tenets=<judgment>`; writes no comment when the output is not in the expected
 *     format; exit 1 when the output looks like it holds a credential
 */
import {
  readFileSync, writeFileSync 
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  containsSecret, sanitize 
} from '../kiro-review/comment.mjs'

export const MARKER = '<!-- kiro-issue-triage -->'
export const BANNER = '> **This is an automated issue triage done with Kiro CLI.** A maintainer reviews it and decides.'
export const LABELS = ['bug', 'enhancement', 'documentation', 'question', 'invalid']
export const TENET_JUDGMENTS = ['aligned', 'needs-alignment', 'conflicts', 'n/a']
export const MAX_BODY = 20_000
export const MAX_COMMENT = 8000
export const MAX_COMMENTS = 30
export const MAX_REPLY = 12_000
const BOT = 'github-actions[bot]'

const capped = (text, max) => {
  const value = typeof text === 'string' ? text : ''
  return value.length > max ? `${value.slice(0, max)}\n\n[truncated at ${max} characters]` : value
}

/** True for a comment this workflow posted (by the Actions bot, starting with the marker). */
export function isTriageReply(comment) {
  return comment?.user?.login === BOT && typeof comment.body === 'string' && comment.body.startsWith(MARKER)
}

/** The Markdown thread the triager reads: the issue, then its newest comments, oldest first. */
export function threadMarkdown(issue, comments) {
  const labels = (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)).join(', ') || 'none'
  const lines = [
    `# Issue #${issue.number}: ${capped(issue.title, 300)}`,
    '',
    `Author: ${issue.user?.login ?? 'unknown'}`,
    `Labels: ${labels}`,
    '',
    '## Body',
    '',
    capped(issue.body, MAX_BODY) || '(empty)',
  ]
  const recent = comments.slice(-MAX_COMMENTS)
  if (comments.length > recent.length) lines.push('', `(${comments.length - recent.length} older comments omitted)`)
  for (const comment of recent) {
    const who = isTriageReply(comment) ? '[kiro]' : (comment.user?.login ?? 'unknown')
    const text = isTriageReply(comment) ? comment.body.slice(MARKER.length) : comment.body
    lines.push('', `## Comment by ${who}`, '', capped(text, MAX_COMMENT).trim() || '(empty)')
  }
  return `${lines.join('\n')}\n`
}

/** `{label, tenets, reply}` from the triager's raw output, or null when it is not in the expected format. */
export function parseReply(raw) {
  // Tolerates the usual format slips: the block wrapped in a code fence, or the keys in bold (`**LABEL:**`).
  const text = raw
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => !/^\s*```\w*\s*$/.test(line))
    .map((line) => line.replace(/^\*\*(LABEL|TENETS):\*\*/, '$1:'))
    .join('\n')
  const start = text.search(/^LABEL:/m)
  if (start === -1) return null
  const [head, ...rest] = text.slice(start).split(/^---[ \t]*$/m)
  const label = /^LABEL:\s*([\w-]+)/m.exec(head)?.[1]?.toLowerCase()
  const tenets = /^TENETS:\s*([\w/-]+)/m.exec(head)?.[1]?.toLowerCase() ?? 'n/a'
  const reply = rest.join('---').trim()
  if (!LABELS.includes(label) || reply === '') return null
  return {
    label,
    tenets: label === 'enhancement' && TENET_JUDGMENTS.includes(tenets) ? tenets : 'n/a',
    reply 
  }
}

/** The comment body for a parsed reply (or the notice for an unparseable one). */
export function buildIssueComment(parsed) {
  if (parsed === null) {
    return `${MARKER}\n${BANNER}\n\nThe triage did not produce a usable answer this time. A maintainer will look at this issue.\n`
  }
  let reply = sanitize(parsed.reply)
  if (reply.length > MAX_REPLY) reply = `${reply.slice(0, MAX_REPLY)}\n\n_(reply truncated)_`
  const judgment = parsed.tenets === 'n/a' ? '' : ` · Tenets: **${parsed.tenets}**`
  const footer = `<sub>Triage: **${parsed.label}**${judgment}. Judged against TENETS.md, README.md and CONTRIBUTING.md (\`scripts/kiro-issue/\`). Reply here to continue; edit the issue to update the request.</sub>`
  return `${MARKER}\n${BANNER}\n\n${reply}\n\n---\n${footer}\n`
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main([command, ...args]) {
  if (command === 'thread' && args.length === 3) {
    const [issuePath, commentsPath, out] = args
    const comments = readJson(commentsPath).flat()
    writeFileSync(out, threadMarkdown(readJson(issuePath), comments))
    console.log(`followups=${comments.filter(isTriageReply).length}`)
    return 0
  }
  if (command === 'reply' && args.length === 2) {
    const [input, out] = args
    const raw = readFileSync(input, 'utf8')
    if (containsSecret(raw)) {
      console.error('kiro-issue: the triage output looks like it contains a credential; nothing is posted')
      return 1
    }
    const parsed = parseReply(raw)
    if (parsed === null) {
      // Nothing is posted: a "could not triage" comment on someone's issue is noise. The run log shows the output.
      console.error('kiro-issue: the triage output is not in the expected format; nothing is posted')
      return 0
    }
    writeFileSync(out, buildIssueComment(parsed))
    console.log(`label=${parsed?.label ?? ''}`)
    console.log(`tenets=${parsed?.tenets ?? 'n/a'}`)
    return 0
  }
  console.error('usage: issue.mjs thread <issue.json> <comments.json> <issue.md> | reply <raw output> <comment.md>')
  return 2
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
