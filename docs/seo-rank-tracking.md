# Rank Tracking

Rank Tracking shows where a domain ranks in Google's organic results for a list of keywords, on desktop and/or
mobile, and how that changes over time. Results come from DataForSEO's Google SERP API.

## Trackers

A tracker is one domain in one market (the market picked in the header when it is created). It holds:

| Setting | Values |
|---|---|
| Domain | Picked from Settings › Brand tracking: your own domains (`first_party_domains`, the first one preselected), then "Competitor: name (domain)" for each `competitor_domains` entry, or "Other domain" (free text). Stored lower-case without `https://`, path or a leading `www.`. With no domain in Brand tracking the form links to Settings › Brand tracking. |
| Market | The header market; not asked again. |
| Keywords | The Settings keywords (`keyword_scope`): `all` (default) = every active keyword of the tracker's market (the Global market = keywords without a market), or `group` = the active keywords of one keyword group (`group_id`, any market). Both are read at every check, so a keyword added in Settings › Keywords is tracked from the next check. |
| Extra keywords | Optional, collapsed in the form: keywords tracked for rankings only (they are not asked of the AI engines). Keywords you want everywhere belong in Settings. |
| Devices | Desktop, Mobile (default) or both. Both devices checks every keyword twice, which doubles the cost of every check. |
| Depth | Top 10 to top 100 results, in pages of 10 (default 30). |
| Schedule | Daily, weekly (default), monthly (last day of the month) or manual only. |

A check covers at most 1,000 keywords: the extra keywords first, then the scope's, deduplicated. When there are
more, the review and the tracker say so ("These keywords number N; each check covers the first 1,000") and the API
returns `scope_keyword_count` > `keyword_count`.

Trackers stored before keyword scopes existed read as `group` when they have a `group_id`, else as `list` (their
extra keywords only); editing one keeps that until another scope is chosen.

Only Admins create, edit, archive, add or remove keywords and start checks. Everyone signed in can read the
results. Archiving stops the schedule and keeps the history; tracking the same domain in the same market again
reactivates it.

## Starting from Settings

While the header market has no tracker, Admins see a card "Track <your domain> for your N keywords in <market>"
(N from the free estimate). Its button opens the prefilled form (all keywords of the market, mobile, top 30,
weekly); nothing is stored or paid for until the review is confirmed. "Track competitors" creates one tracker per
competitor domain of Brand tracking not yet tracked in the market, with the same keywords and defaults, after one
confirmation naming the paid searches per tracker. Readers who are not Admins see an empty state.

## How a position is found

- Only organic results count. A featured snippet, "People also ask", AI Overview, local pack or sitelink never
  counts as a position.
- The domain and every subdomain match (`blog.example.com` counts for `example.com`); the best-ranked page wins
  and its URL is shown.
- The position is Google's organic rank (what a reader counts), not the absolute position that also counts SERP
  features.
- The SERP features present on the page are listed beside each result.

## Re-checks and "Not found (unconfirmed)"

Google sometimes serves a results page that leaves out sites which really rank. After a check, a keyword is
checked again (up to twice, through DataForSEO's cheaper queue) when its check failed, when it dropped 10 or more
places from its best known position, when it ranked before and was not found, or when it was not found on its
first check ever. The best position found is kept. When one device is re-checked, both are.

A keyword that ranked before and is still missing after the re-checks shows as **Not found (unconfirmed)**. It is
shown as lost only when the next check misses it too, or when it never ranked.

A keyword without any answer in a check (DataForSEO failed) shows as not checked, which is different from not
found. A check that answered only some keywords on a device is marked partial; a check that answered none failed.

## Prices

Prices are DataForSEO's list prices per search; your account is billed directly.

| Method | First page (10 results) | Each extra page |
|---|---|---|
| Live (manual checks) | $0.002 | $0.0015 |
| Queued (scheduled checks and every re-check) | $0.0006 | $0.00045 |

A keyword containing a search operator (`site:`, `intitle:`, `inurl:` …) costs five times as much. One search is
made per keyword and device. DataForSEO stops paging, and billing pages, once the domain is found, so a check
usually costs less than its estimate.

Saving a tracker or starting a check first asks for confirmation, naming the paid searches per check (and, for a
schedule, the checks a month); the dashboard shows no price. The worst case is the check itself plus two queued
re-check rounds of every keyword. Example: 100 keywords on both devices at depth 30 cost at most $1.00 + $0.60 for a
manual check, and at most $0.90 per scheduled check (about $3.60 a month weekly).

## Schedule

- Each scheduled tracker has its own one-time EventBridge Scheduler schedule at its next slot (`rank-<tracker id>`
  in the `citation-analysis-seo-rank` group). Saving, archiving or switching a tracker to manual moves or deletes it;
  each check moves it to the next slot. Nothing runs between checks. Operations › Schedule lists these schedules
  read-only, with a link back to the tracker.
- The first slot of a new schedule is at a random time between 04:00 and 09:59 UTC, so checks spread over the
  morning: tomorrow (daily), in seven days (weekly), or on the last day of this month (monthly).
- Later slots follow the first one exactly, even when a check started late, so the schedule never drifts.
- Editing a tracker keeps its slot unless the schedule itself changes.
- A tracker without keywords is skipped until its next slot. A tracker with a check still running (or whose start
  failed before it was claimed) is tried again 15 minutes later.
- A scheduled check queues its searches with DataForSEO and waits for DataForSEO to call back when each one is ready
  (`pingback_url`, `lambda/seo-callbacks`); nothing polls the queue. If a callback has not come 35 minutes after the
  post, the check reads every queued search once anyway, and a search still running then goes to the re-check rounds.
- One check runs per tracker at a time. A manual check answers at once and runs in the background; the page shows its
  progress and refreshes the results when it ends, on the check's live events (nothing polls).

## Reading the results

- **Latest results**: each keyword's newest position per device, compared with a check from yesterday, last week,
  last month or 90 days ago (the newest finished check from before then, else the oldest one). An arrow shows a rise
  or fall; Export all queues an Excel or CSV export of the table on the server, in the table's order (change =
  previous − current, `new`, or `lost`), and the file appears on the Exports page.
- **Keyword history**: click a keyword to see its position per device over the last year; a miss is drawn at the
  bottom of the chart.
- **Position distribution**: per finished check, the number of keywords in the top 3, 4–10, 11–20, not in the top
  20, and not checked.

## Limits

- Up to 1,000 keywords per check (see above); up to 200 keyword ids removed per request.
- History is read for up to 365 days.
- Markets are countries (with their language); city-level tracking is not available.
