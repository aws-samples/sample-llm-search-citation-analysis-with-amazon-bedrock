# Backlinks

The Backlinks page (SEO › Backlinks, `/seo/backlinks`) shows who links to a site, what changed recently and which pages get the most links, and how your domains' authority compares with your competitors' over time. Data comes from DataForSEO's Backlinks API.

The page needs the SEO stack to be deployed and a DataForSEO login saved in Settings › AI providers.

## Looking up a target

Enter a domain or URL and choose a scope. The scope follows what you type until you pick one yourself:

| Scope | What is counted | Example |
|---|---|---|
| Subdomains (default for a domain) | The domain and all its subdomains | `*.example.com/*` |
| Domain | The hostname only, without its subdomains | `example.com/*` |
| Subfolder (default for a URL with a path) | The path and everything under it | `example.com/blog/*` |
| Exact URL | One page only | `example.com/pricing` |

The page starts from Settings › Brand tracking. With the input empty, the button reads **Analyze &lt;own domain&gt;** (the first owned domain; nothing is fetched until it is clicked), and the quick-pick buttons search your own domains (green, first) and your competitors' domains (amber) from Brand tracking, plus any other domain with stored snapshots, with their subdomains. Without an owned domain the page links to Settings › Brand tracking.

Some targets are refused before anything is billed:

- a host that is not a real domain (`my_site.com`, IP addresses, `localhost`);
- a URL with a login in it;
- Subfolder without a path;
- an exact page with `?query` or `#fragment`.

An exact page keeps `www.` and `http://` as typed, because DataForSEO matches page URLs exactly.

### Overview

These metrics have help texts on the page:

- rank (DataForSEO's 0–100 authority score);
- backlinks, referring domains and referring pages;
- broken backlinks and broken pages;
- the spam score of the backlinks and of the target itself;
- recent new and lost backlinks and referring domains.

`—` means unknown, which is different from 0.

The "Backlink growth" and "New vs lost" charts cover the last 12 months. They exist only for the Domain and Subdomains scopes. DataForSEO keeps history per hostname, so the charts always include subdomains. An exact page has no history. A subfolder only gets totals: its backlinks and referring domains are counted from its URLs, and likely spam is included.

### Tables

There are three tabs, each sorted and filtered on the server:

- **Backlinks**: individual links, newest first.
- **Referring domains**: the domains that link to the target. This tab is not available for a subfolder, because DataForSEO cannot break referring domains down by path.
- **Top pages**: the target's pages that get the most links.

On the Backlinks tab, "One per domain" shows each linking domain's strongest link. Use the chevron to load all links from that domain. "All links" lists every link. Page sizes are 50, 100 or 200.

**Likely spam** is hidden by default on the Backlinks and Referring domains tabs. A row is hidden when its spam score is 40 or higher. A row with no spam score stays visible. The same rule applies everywhere on the page. Tick "Include likely spam" to see every row.

**Filter limit**: DataForSEO allows 8 filter conditions per request.

- Each include or exclude term, each min or max value and each flag counts as one condition.
- The spam rule uses 2 conditions.
- A subfolder scope uses 4 conditions.

The filter panel shows how many conditions you have used. If the filters go over the limit, no request is sent, and the server would refuse one anyway. Nothing is silently dropped.

**Export** opens a dialog that exports the table as it is sorted and filtered now, as Excel or CSV, on the server: the file appears on the Exports page. Pick how many rows to export (up to 10,000) and the dialog shows the DataForSEO price; the server refuses an export whose row count or price was not confirmed, and pays for each 1,000-row window at most once. "Export the N rows on screen (free)" exports the page you see from the cache instead. In a CSV file, a cell that starts with `=`, `+`, `-` or `@` gets a leading `'` so that a spreadsheet does not run it as a formula.

## Authority over time

Snapshots record the overview metrics of every owned and competitor domain, with subdomains. They are kept, never expired. The chart compares the rank of your domains with your competitors'. Reading snapshots is free.

Admins can:

- **Snapshot now**: takes one snapshot of every tracked domain, after a confirmation that names the paid calls (one per domain) and their estimated price.
- **Schedule weekly snapshots**: the link opens Operations › Schedule, where a **Backlink snapshots** schedule (paid) runs them daily, weekly or monthly, at the time and zone the Admin picks. Saving an enabled one asks first and names its paid calls (one per domain). Nothing runs until such a schedule exists, and a disabled one costs nothing.

A run skips domains that were snapshotted less than 20 hours ago. It does not store empty answers. A failed domain is not retried, because DataForSEO bills the call even when it fails. A low-balance or login error stops the run.

## Prices (DataForSEO list prices)

| Action | Cost |
|---|---|
| Overview of a domain (summary + one year of history) | about $0.06 ($0.024 + $0.037) |
| Overview of an exact page | about $0.024 |
| Overview of a subfolder (two counts) | about $0.048 |
| One table page | $0.024 + $0.000036 per row (about $0.03 for 100 rows) |
| Expanding a referring domain | one table page of 100 rows |
| Snapshot | about $0.024 per domain |

Answers are cached for 6 hours for every combination of target, scope, page, sort, filters, link mode and spam setting. A cached answer is free. Empty table pages are cached for 1 hour. If the history call fails, the overview is cached for only 15 minutes, so searching again soon retries the history.
