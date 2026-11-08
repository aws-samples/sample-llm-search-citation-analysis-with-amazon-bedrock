# Local SEO

Local SEO shows how a business appears on Google Maps and in its Google Business Profile, from DataForSEO. The
page has four tabs and works in the market chosen in the header. Leave the latitude and longitude empty to search
around the market's city. This needs the market's city coordinates, which Settings › Markets fills in.

The forms start from Settings instead of asking again: the business name in Business search and Business profile
is the brand's first name (Settings › Brand Tracking), "your business" in Local results and the rank grid is the
brand's own domain when left empty, and the keyword fields suggest the header market's keywords (Settings ›
Keywords). Anything you type is kept. When Settings lacks the brand name, the own domain or the market city, the
tab links to the section to fill in.

Nothing is bought until you click. Opening the page, changing tab or focusing a field costs nothing. An answer
reused from the cache says "From cache"; the page shows no prices.

## Tabs

| Tab | What it shows | Cached |
|---|---|---|
| Business search | Google business listings near a point, by name and/or category: rating, review count, category, claimed or not, phone, website. Sort by relevance, rating or reviews (businesses without a value sort last). **Open** loads a business's profile. | 24 h |
| Business profile | One Google Business Profile, named by business name, Google cid or place id: categories, rating, address, phone, website, opening state, photos. Below it, on demand: **Reviews** (rating histogram, latest reviews, how many the owner answered), **Updates and posts**, and **Questions and answers**. Google keeps Q&A for few businesses, and the page says so when there is none. | 24 h (profile, Q&A); reviews and updates are reused for 1 h |
| Local results | Google Maps or Local Finder results for a keyword around a point, on mobile or desktop, and the position of your business in them. Your business is matched by cid, then place id, then website domain, then name. With nothing entered, the brand's own domains (Settings › Brand) are used. | 12 h |
| Local rank grid | Your business's Maps rank at every point of a 3 × 3, 5 × 5 or 7 × 7 grid around a centre, 0.25 to 10 km apart. Cells are green for the top 3, amber for the top 10, red for lower ranks and grey when the business is not in the top 20. A cross marks a point whose search failed (DataForSEO may still charge for it). | 1 h |

Every point of a grid uses the same Maps zoom, derived from the spacing so that one map covers about one grid
cell. If DataForSEO picked a zoom per point, some points would come back empty and the ranks could not be compared.

## Queued work

Reviews, updates and rank grids run in DataForSEO's priority queue. One click buys the tasks; DataForSEO calls back
when each task is ready (`pingback_url`, `lambda/seo-callbacks`), and the job then collects the results for free,
usually within a minute. Nothing polls DataForSEO's queue; the page checks the job every 5 seconds until it ends.
Asking for the same reviews, updates or grid again within an hour collects the tasks already bought and does not
buy them again. For a grid this holds even when you change which business to look for. If a callback has not come
after 25 minutes, the job collects once anyway; a task still running then leaves the job timed out, the page says
so, and asking again collects the results at no extra cost. If every grid point fails, the next request buys fresh
searches.

A bought task is never posted twice. DataForSEO bills when a task is posted, so a failed post is not retried.

## Prices

Approximate DataForSEO prices in USD (read from DataForSEO's price table, September 2026), for reference: the page
shows no prices. A rank grid asks for confirmation first, naming its paid calls (one Maps search per point).

| Action | Price |
|---|---|
| Business search | $0.012 + $0.00036 per business (20 businesses: $0.0192) |
| Business profile | $0.0054 |
| Questions and answers | $0.0054 per 20 questions |
| Reviews | about $0.001 + $0.0015 per 10 reviews (approximate: not yet checked against billed tasks) |
| Updates and posts | $0.003 + $0.0015 per 10 posts |
| Google Maps results | $0.002 |
| Local Finder results | $0.002 per 10 results |
| Rank grid | $0.0012 per point (3 × 3: $0.0108, 5 × 5: $0.03, 7 × 7: $0.0588) |
| Category list, checking a queued job | free |

## Limits

- Business search: up to 50 businesses per search, a radius of 1 to 100 km, and up to 10 categories.
- Reviews: 10 to 200. Updates: 10 to 100. Questions: up to 100.
- Grid spacing: 0.25 to 10 km. Grid ranks cover the top 20 Maps results at each point.
- A business is named by exactly one of its name, its Google cid or its place id. The cid is the most precise.
  Business search and local results show it.
- Every route needs a signed-in user. These are one-off lookups that schedule no recurring spend, so they are
  open to every user, not only Admins.

## API

All routes are under `/api/seo/local` on the SEO API.

| Route | Paid |
|---|---|
| `GET /categories?query=&limit=` | no |
| `POST /businesses` | yes |
| `POST /profile` | yes |
| `POST /questions` | yes |
| `POST /serp` | yes |
| `POST /jobs` `{kind: 'reviews' \| 'updates' \| 'grid', ...}` | yes (unless an equal job from the last hour is reused) |
| `GET /jobs/{job_id}` (a grid can be ranked for another business with `cid`, `place_id`, `domain` or `name`) | no |
