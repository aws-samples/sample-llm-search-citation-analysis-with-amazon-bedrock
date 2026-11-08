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
 * Usage: node scripts/kiro-review/conversation.mjs <issue-comments.json> <reviews.json> <review-comments.json> <out.md>
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

/** How the reviewer should weigh an author: its own review, a maintainer, a bot, or anyone else. */
export function roleOf(entry) {
  if (isOwnReview(entry)) return 'kiro, your previous review'
  if (entry.user?.type === 'Bot' || entry.user?.login?.endsWith('[bot]')) return 'bot'
  if (MAINTAINERS.has(entry.author_association)) return 'maintainer'
  return 'contributor'
}

const capped = (text, max) => (text.length > max ? `${text.slice(0, max)}\n[truncated at ${max} characters]` : text)

/** One entry per comment, review and inline comment that says something, oldest first. */
export function entries(issueComments, reviews, reviewComments) {
  const all = [
    ...issueComments.map((c) => ({
      ...c,
      kind: 'comment',
      at: c.created_at 
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

/** The conversation as Markdown, newest entries kept when it is long; the reviewer's own last review always kept. */
export function conversationMarkdown(issueComments, reviews, reviewComments) {
  const list = entries(issueComments, reviews, reviewComments)
  if (list.length === 0) return 'No comments or reviews on this pull request yet.\n'
  const own = list.filter(isOwnReview).at(-1)
  const others = list.filter((e) => !isOwnReview(e)).slice(-MAX_ENTRIES)
  const kept = [...others, ...(own ? [own] : [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const blocks = kept.map((e) => {
    const body = isOwnReview(e) ? e.body.slice(MARKER.length) : e.body
    return `## ${e.kind} by ${e.user?.login ?? 'unknown'} (${roleOf(e)}), ${e.at}\n\n${capped(body.trim(), MAX_ENTRY)}`
  })
  let text = blocks.join('\n\n')
  if (text.length > MAX_TOTAL) text = `[older entries cut]\n\n${text.slice(-MAX_TOTAL)}`
  const omitted = list.length - kept.length
  const note = omitted > 0 ? `(${omitted} older entries omitted)\n\n` : ''
  return `${note}${text}\n`
}

function pages(path) {
  return JSON.parse(readFileSync(path, 'utf8')).flat()
}

function main(argv) {
  if (argv.length !== 4) {
    console.error('usage: conversation.mjs <issue-comments.json> <reviews.json> <review-comments.json> <out.md>')
    return 2
  }
  const [issueComments, reviews, reviewComments, out] = argv
  writeFileSync(out, conversationMarkdown(pages(issueComments), pages(reviews), pages(reviewComments)))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
