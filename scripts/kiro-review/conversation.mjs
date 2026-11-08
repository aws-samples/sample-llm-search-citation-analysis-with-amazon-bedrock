#!/usr/bin/env node
/**
 * The pull request's conversation as the Kiro reviewer reads it (`data/conversation.md`): the PR's comments, its
 * reviews and its inline review comments, oldest first, each with its author and role, and the reviewer's own last
 * review marked as such. Run by `.github/workflows/kiro-review.yml` on the GitHub API's JSON.
 *
 * Why: without it every review starts from zero and repeats points the author already answered. With it, the
 * reviewer can say which of its earlier points are resolved and treat a maintainer's explicit decision as settled.
 *
 * Everything here is untrusted text written by anyone who can comment, so it is capped (it costs credits and could
 * crowd out the diff) and the reviewer's prompt treats it as data.
 *
 * Usage: node scripts/kiro-review/conversation.mjs <issue-comments.json> <reviews.json> <review-comments.json> <out.md> [pr-author]
 *   Each JSON file is a `gh api --paginate --slurp` result (an array of pages).
 */
import {
  readFileSync, writeFileSync 
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MARKER } from './comment.mjs'

export const MAX_ENTRY = 6000
export const MAX_ENTRIES = 60
export const MAX_TOTAL = 120_000
const BOT = 'github-actions[bot]'
const MAINTAINERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** True for the reviewer's own comment (the Actions bot, starting with the review marker). */
export function isOwnReview(entry) {
  return entry.user?.login === BOT && typeof entry.body === 'string' && entry.body.startsWith(MARKER)
}

/**
 * How the reviewer should weigh an author: its own review, a bot, the PR's author (who cannot settle their own
 * review's points the way another maintainer can), a maintainer, or anyone else.
 */
export function roleOf(entry, prAuthor = '') {
  if (isOwnReview(entry)) return 'kiro, your previous review'
  if (entry.user?.type === 'Bot' || entry.user?.login?.endsWith('[bot]')) return 'bot'
  const maintainer = MAINTAINERS.has(entry.author_association)
  if (prAuthor !== '' && entry.user?.login === prAuthor) return maintainer ? 'PR author, maintainer' : 'PR author'
  return maintainer ? 'maintainer' : 'contributor'
}

const capped = (text, max) => (text.length > max ? `${text.slice(0, max)}\n[truncated at ${max} characters]` : text)

/** One entry per comment, review and inline comment that says something, oldest first. */
export function entries(issueComments, reviews, reviewComments) {
  const all = [
    // The reviewer's own comment is edited in place on every push, so its last edit dates it.
    ...issueComments.map((c) => ({
      ...c,
      kind: 'comment',
      at: isOwnReview(c) ? (c.updated_at ?? c.created_at) : c.created_at,
    })),
    ...reviews.map((r) => ({
      ...r,
      kind: `review (${String(r.state ?? '').toLowerCase()})`,
      at: r.submitted_at 
    })),
    ...reviewComments.map((c) => ({
      ...c,
      kind: `inline comment on ${c.line ? [c.path, c.line].join(':') : c.path}`,
      at: c.created_at 
    })),
  ]
  return all
    .filter((e) => typeof e.body === 'string' && e.body.trim() !== '')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
}

/**
 * A body that cannot pose as an entry: every line is quoted (`> `), so only the generated `## ` headings start at the
 * margin and only they carry an author and a role. A forged `## comment by owner (maintainer)` line in a comment stays
 * inside its quote.
 */
export function quoted(body) {
  return body.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')
}

function block(entry, prAuthor) {
  const body = isOwnReview(entry) ? entry.body.slice(MARKER.length) : entry.body
  const heading = `## ${entry.kind} by ${entry.user?.login ?? 'unknown'} (${roleOf(entry, prAuthor)}), ${entry.at}`
  return `${heading}\n\n${quoted(capped(body.trim(), MAX_ENTRY))}`
}

const byTime = (a, b) => String(a.at).localeCompare(String(b.at))

/**
 * The conversation as Markdown. When it is long, whole entries are dropped oldest first (never part of one) until it
 * fits MAX_ENTRIES and MAX_TOTAL; the reviewer's own last review is always kept.
 */
export function conversationMarkdown(issueComments, reviews, reviewComments, prAuthor = '') {
  const list = entries(issueComments, reviews, reviewComments)
  if (list.length === 0) return 'No comments or reviews on this pull request yet.\n'
  const own = list.filter(isOwnReview).at(-1)
  const ownBlock = own ? block(own, prAuthor) : ''
  let budget = MAX_TOTAL - ownBlock.length
  const others = []
  for (const entry of list.filter((e) => !isOwnReview(e)).reverse()) {
    const text = block(entry, prAuthor)
    if (others.length >= MAX_ENTRIES || text.length + 2 > budget) break
    budget -= text.length + 2
    others.push({
      entry,
      text 
    })
  }
  const kept = [...others, ...(own ? [{
    entry: own,
    text: ownBlock 
  }] : [])].sort((a, b) => byTime(a.entry, b.entry))
  const omitted = list.length - kept.length
  const note = omitted > 0 ? `(${omitted} older entries omitted)\n\n` : ''
  return `${note}${kept.map((k) => k.text).join('\n\n')}\n`
}

function pages(path) {
  return JSON.parse(readFileSync(path, 'utf8')).flat()
}

function main(argv) {
  if (argv.length < 4 || argv.length > 5) {
    console.error('usage: conversation.mjs <issue-comments.json> <reviews.json> <review-comments.json> <out.md> [pr-author]')
    return 2
  }
  const [issueComments, reviews, reviewComments, out, prAuthor = ''] = argv
  writeFileSync(out, conversationMarkdown(pages(issueComments), pages(reviews), pages(reviewComments), prAuthor))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
