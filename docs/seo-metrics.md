# SEO vs GEO metrics

The SEO vs GEO report (`/reports/seo-geo`, `GET /api/seo/seo-geo`) sets each tracked keyword's organic Google standing
next to its visibility in AI answers, per keyword and market. These are **not** answer KPIs: the KPIs and their one
definition each stay in [kpi-definitions.md](kpi-definitions.md). The rules live in `lambda/shared/seo_geo.py`; the
dashboard's tooltips read `web/src/constants/seoGeoDefinitions.ts`, which says the same as this page.

## Where the data comes from

Every value comes from one analysis run per keyword: its **latest run with a Google AI Overviews result** (a row of
provider `google_ai_overview` with status `success` or `no_answer`). That row holds both the AI Overview and the
organic top 10 of the same Google results page (one DataForSEO call, depth 10). The AI answers of the other engines
are read from the same run.

## Metrics

| Metric | Definition |
|---|---|
| Volume | Average monthly Google searches for the keyword in the market (DataForSEO keyword metrics); blank until its metrics are fetched. |
| Organic position | Your best position in the organic top 10 of that results page (one of your domains or a subdomain, `www.` ignored); ">10" when none of your domains is in it. Positions count organic results only (`rank_group`). |
| Ranked position | Your best organic position from a deeper source when that results page has none of your domains in its top 10: a rank-tracked position, else your latest estimated traffic snapshot (DataForSEO ranked keywords, positions 1-100). Blank when neither ranks you. The quadrant keeps using the organic position of the results page, so it always describes the page the AI Overview was read from. |
| Estimated traffic | Estimated monthly organic visits your domains get from the keyword, from their latest weekly snapshot in the market: DataForSEO's estimate from search volume and position, not measured clicks. Blank without a snapshot. |
| Competitor organic position | The same best position for each competitor with domains set in Brand Tracking. |
| AI Overview shown | Whether Google showed an AI Overview: "Yes" for a results page with one, "No" for a page without. A page without an overview is *no answer* and counts in no KPI. |
| AI Overview cites you | Whether one of your domains is among the AI Overview's references; blank when Brand Tracking lists no domain of yours. |
| AI mention rate | The `mention_rate` KPI for the keyword in that run: the share of successful answers, every AI engine including Google AI Overviews, that name your brand. |
| Answers | The successful AI answers for the keyword in that run that the AI mention rate counts. |
| Citation overlap | The percentage of distinct URLs cited by the run's AI answers (the AI Overview's references included) that are also in its organic top 10; blank when the answers cite nothing. |

## Estimated search traffic against AI mentions

| Metric | Definition |
|---|---|
| Share of estimated search traffic | Your (or a competitor's) estimated monthly organic visits over the keywords in scope, as a share of the total of you and every competitor with domains set in Brand Tracking. From each domain's latest weekly snapshot (DataForSEO estimates, not measured clicks); blank for a brand without a snapshot. |
| Share of AI mentions | The share of voice KPI over the same keywords' latest runs: the brand's share of every brand mention in the successful AI answers. |

Snapshots, their prices and the SEO recommendations built on these rows: [seo-domain.md](seo-domain.md).

## Quadrants

SEO strong = organic position 10 or better. GEO strong = AI mention rate 50% or more.

| Quadrant | Meaning |
|---|---|
| Both strong | In Google's top 10 and named in at least 50% of AI answers. |
| AI gap | In Google's top 10 but named in fewer than 50% of AI answers: the AI engines do not reflect your search standing. |
| SEO gap | Named in at least 50% of AI answers but not in Google's top 10. |
| Both weak | Not in Google's top 10 and named in fewer than 50% of AI answers. |
| No data | No analysis run with a Google AI Overviews result yet, or no successful AI answer in it. |

Rows are sorted by search volume (largest first, unknown last), so the largest opportunities lead.
