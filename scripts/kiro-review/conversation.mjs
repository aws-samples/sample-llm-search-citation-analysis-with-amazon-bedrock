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
 * Usage:
 *   node scripts/kiro-review/conversation.mjs commenters <issue-comments.json> <reviews.json> <review-comments.json>
 *     prints one login per line: the human commenters whose permission the workflow then looks up
 *   node scripts/kiro-review/conversation.mjs <issue-comments.json> <reviews.json> <review-comments.json> <out.md>
 *       [pr-author] [maintainers.txt]
 *     maintainers.txt: the commenters with write access or more, one login per line
 *   Each JSON file is a `gh api --paginate --slurp` result (an array of pages).
 */
import {
  readFileSync, writeFileSync 
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MARKER, MAX_BODY 
} from './comment.mjs'

export const MAX_ENTRY = 6000
export const MAX_ENTRIES = 60
export const MAX_TOTAL = 120_000
const BOT = 'github-actions[bot]'

/** True for the reviewer's own comment (the Actions bot, starting with the review marker). */
export function isOwnReview(entry) {
  return entry.user?.login === BOT && typeof entry.body === 'string' && entry.body.startsWith(MARKER)
}

/**
 * How the reviewer should weigh an author: its own review, a bot, the PR's author (who cannot settle their own
 * review's points the way another maintainer can), a maintainer (in `maintainers`), or anyone else.
 */
export function roleOf(entry, prAuthor = '', maintainers = new Set()) {
  if (isOwnReview(entry)) return 'kiro, your previous review'
  if (entry.user?.type === 'Bot' || entry.user?.login?.endsWith('[bot]')) return 'bot'
  // A maintainer is someone with write access or more (the workflow asks GitHub per commenter), not an
  // `author_association`: COLLABORATOR covers read-only invitees and MEMBER every member of the organisation.
  const maintainer = maintainers.has(entry.user?.login)
  if (prAuthor !== '' && entry.user?.login === prAuthor) return maintainer ? 'PR author, maintainer' : 'PR author'
  return maintainer ? 'maintainer' : 'contributor'
}

const capped = (text, max) => (text.length > max ? `${text.slice(0, max)}\n[truncated at ${max} characters]` : text)

/**
 * The distinct human commenters the workflow asks GitHub about (one API call each): the authors of the newest
 * MAX_ENTRIES entries, newest first, so a busy or spammed pull request cannot run up the token's request budget.
 */
export function commenters(issueComments, reviews, reviewComments) {
  const newest = entries(issueComments, reviews, reviewComments).reverse()
  const logins = newest.filter((e) => roleOf(e) === 'contributor').map((e) => e.user?.login).filter(Boolean)
  return [...new Set(logins)].slice(0, MAX_ENTRIES)
}

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
      at: r.submitted_at ?? r.created_at ?? '' 
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

/** One line of plain text: a file path or a review state can carry a newline (git allows one in a file name). */
const oneLine = (value) => [...String(value ?? '')]
  .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
  .join('')
  .replaceAll(/ {2,}/g, ' ')
  .trim()

function block(entry, prAuthor, maintainers) {
  const body = isOwnReview(entry) ? entry.body.slice(MARKER.length) : entry.body
  const who = oneLine(entry.user?.login ?? 'unknown')
  const heading = `## ${oneLine(entry.kind)} by ${who} (${roleOf(entry, prAuthor, maintainers)}), ${oneLine(entry.at)}`
  // Its own previous review is kept whole (up to the comment's own size limit): every point in it is re-checked.
  const max = isOwnReview(entry) ? MAX_BODY + 2000 : MAX_ENTRY
  return `${heading}\n\n${quoted(capped(body.trim(), max))}`
}

const byTime = (a, b) => String(a.at).localeCompare(String(b.at))

/**
 * The conversation as Markdown. When it is long, whole entries are dropped oldest first (never part of one) until it
 * fits MAX_ENTRIES and MAX_TOTAL; the reviewer's own last review is always kept.
 */
export function conversationMarkdown(issueComments, reviews, reviewComments, prAuthor = '', maintainers = new Set()) {
  const list = entries(issueComments, reviews, reviewComments)
  if (list.length === 0) return 'No comments or reviews on this pull request yet.\n'
  const own = list.filter(isOwnReview).at(-1)
  const ownBlock = own ? block(own, prAuthor, maintainers) : ''
  let budget = MAX_TOTAL - ownBlock.length
  const others = []
  for (const entry of list.filter((e) => !isOwnReview(e)).reverse()) {
    const text = block(entry, prAuthor, maintainers)
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
  if (argv[0] === 'commenters' && argv.length === 4) {
    const [, issueComments, reviews, reviewComments] = argv
    for (const login of commenters(pages(issueComments), pages(reviews), pages(reviewComments))) console.log(login)
    return 0
  }
  if (argv.length < 4 || argv.length > 6) {
    console.error('usage: conversation.mjs [commenters] <issue-comments.json> <reviews.json> <review-comments.json> [<out.md> [pr-author] [maintainers.txt]]')
    return 2
  }
  const [issueComments, reviews, reviewComments, out, prAuthor = '', maintainersFile = ''] = argv
  const maintainers = new Set(maintainersFile ? readFileSync(maintainersFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [])
  writeFileSync(out, conversationMarkdown(pages(issueComments), pages(reviews), pages(reviewComments), prAuthor, maintainers))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
