# Page performance

Page performance measures the brand's own pages with Google Lighthouse (through DataForSEO) and tells search
engines about changed pages with IndexNow. The page has two tabs.

## Lighthouse

**Measure a page** runs Lighthouse on one page of the brand's own domains (Settings › Brand Tracking, or a
subdomain of one) on mobile or desktop. The URL starts at the homepage of the brand's first own domain and suggests
the latest finished site audit's pages (its sample pages, then up to 50 crawled pages, read for free when the field
is first focused); without an own domain the form links to Settings › Brand Tracking. Nothing runs until **Run
Lighthouse** is pressed. A run takes up to a minute; the page shows its progress and then:

- the four category scores, 0 to 100: Performance, Accessibility, Best practices, SEO (90 and above is good, 50 to
  89 needs improvement, below 50 is poor);
- the metrics, each rated against its published limits:

  | Metric | Good | Poor |
  |---|---|---|
  | Largest Contentful Paint (Core Web Vital) | ≤ 2.5 s | > 4.0 s |
  | Cumulative Layout Shift (Core Web Vital) | ≤ 0.10 | > 0.25 |
  | Interaction to Next Paint (Core Web Vital) | ≤ 200 ms | > 500 ms |
  | Server response time (TTFB) | ≤ 800 ms | > 1.8 s |
  | First Contentful Paint | ≤ 1.8 s | > 3.0 s |
  | Total Blocking Time | ≤ 200 ms | > 600 ms |

  Lighthouse is a lab test: no visitor interacts with the page, so Interaction to Next Paint is usually "Not
  measured". Total Blocking Time is the lab stand-in for it.
- the top opportunities: up to 10 failed audits, worst first, with the time or bytes fixing each would save.
  An audit is critical when it would save 300 ms or 150 KB or more, or scores below 50; a warning from 100 ms or
  50 KB, or a score below 90.

**Audit sample pages** (Admin) measures the latest finished site audit's homepage and one page per URL template
(`/blog/:slug`, `/products/:id`, …), at most 10 pages, each on mobile and desktop: up to 20 runs. Only pages the
audit loaded cleanly are used, so a bot challenge is never measured. The page lists the pages and asks for
confirmation first, naming the paid calls (one per page and device; no price is shown).

**Recent runs** lists the 20 newest runs; **Show** reopens one at no cost. Runs are kept for 30 days. The full
Lighthouse report of every page is kept in the raw-responses bucket (`seo/lighthouse/`).

Asking again for the same page and device, or the same audit sample, within 15 minutes shows the run already
started and buys nothing. A run is never retried: DataForSEO bills a run when it executes it, so a failed or
timed-out run is reported on its page instead of being bought again.

### Prices

| Action | Price |
|---|---|
| One page on one device | $0.005 |
| Audit sample (10 pages × 2 devices) | up to $0.10 |

Approximate DataForSEO price in USD. Measuring one page is open to every signed-in user; the batch is Admin only.

## IndexNow

IndexNow tells Bing, Yandex, Yep and the other participating engines that pages were added or changed, so they
crawl them sooner. The engines share every submission, so one accepted request reaches all of them. Google does
not take part. IndexNow is free.

1. **Create the key** (Admin): one 32-character key per owned domain; its subdomains share it. The key is not a
   secret: the engines read it from your site to check that you own it.
2. **Host the key file**: a plain-text file named `<key>.txt` containing only the key, at the root of every host
   you submit (for example `https://example.com/<key>.txt` and `https://www.example.com/<key>.txt`), served
   directly, without a redirect.
3. **Check key file** fetches it from the domain and its `www.` host and says whether it is found, missing, has
   the wrong content, redirects, forwards to another host, or could not be read (a bot wall can hide a good file;
   the engines then check it themselves).
4. **Submit URLs** (Admin): paste up to 10,000 URLs, one per line, or press **Submit the pages of the latest
   audit** (the pages that audit loaded cleanly). URLs off the brand's own domains are skipped and counted. URLs
   are sent per host, first to Bing, then to Yandex, then to Yep; the next engine is tried only when one does not
   answer, is rate-limiting (HTTP 429) or fails (5xx). A host whose key file is missing, wrong or redirecting is
   not submitted, and the page says what to fix.

Each host's result shows every engine's answer. HTTP 200 means accepted; 202 means accepted once the engine has
verified the key file; 403 means the key was not accepted; 429 means the engines are refusing submissions for
now. Submit only pages that are new or changed: resubmitting the whole site gets submissions refused.

The 20 newest submissions are listed below the form.
