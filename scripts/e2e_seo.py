#!/usr/bin/env python3
"""
Live end-to-end check of the SEO pages' data on a deployed stack (``npm run e2e:seo``). Free: it calls only the
routes that read stored data, never one that asks DataForSEO (and pays) for something.

Against the real ``CitationAnalysis-SeoRouter`` Lambda, as an Admin, every route a page opens with must answer 200
with the shape its page reads:

- Settings > AI Providers: ``GET /api/seo/account`` - DataForSEO configured, with a balance;
- SEO vs GEO report: ``GET /api/seo/seo-geo`` - a summary of every quadrant and one row per keyword; with
  ``--group <id>``, that group's keywords must have Google AI Overviews data (the ``Search-google_ai_overview`` workflow branch ran);
- Rank Tracking, Site Audit, Performance (Lighthouse, IndexNow) and Backlinks snapshots: their list routes;
- Domain Overview: the stored traffic snapshots of the brand's first own domain.

Not part of ``npm run validate``: it needs AWS credentials and a deployed stack.

Usage: ``.venv/bin/python scripts/e2e_seo.py [--region us-west-2] [--group <keyword group id>]``
"""

from __future__ import annotations

import argparse
import sys

from e2e_live import E2EFailureError, LiveApi, api_event, expect, require

FUNCTION = 'CitationAnalysis-SeoRouter'
QUADRANTS = ('both_strong', 'ai_gap', 'seo_gap', 'both_weak', 'no_data')

#: The list routes of the SEO pages, each with a key its page reads from the answer.
LIST_ROUTES: tuple[tuple[str, str, str], ...] = (
    ('Rank Tracking trackers', '/api/seo/rank-trackers', 'trackers'),
    ('Site Audit audits', '/api/seo/audits', 'audits'),
    ('Performance Lighthouse runs', '/api/seo/lighthouse', 'runs'),
    ('Performance IndexNow setup', '/api/seo/indexnow', 'sites'),
    ('Backlinks authority snapshots', '/api/seo/backlinks/snapshots', 'domains'),
)


def check_account(api: LiveApi) -> None:
    status, body = api.call(FUNCTION, api_event('GET', '/api/seo/account'))
    expect('DataForSEO account', status, body, 200)
    require('DataForSEO is configured with a balance', body.get('configured') is True
            and isinstance(body.get('balance_usd'), int | float), body)


def check_seo_geo(api: LiveApi, group_id: str | None) -> None:
    query = None if group_id is None else {'group_id': group_id}
    status, body = api.call(FUNCTION, api_event('GET', '/api/seo/seo-geo', query=query))
    expect('SEO vs GEO report' + ('' if group_id is None else ' of the group'), status, body, 200)
    summary, rows = body.get('summary') or {}, body.get('rows') or []
    require('the report counts every quadrant', all(isinstance(summary.get(name), int) for name in QUADRANTS), summary)
    require('the quadrant counts add up to the keywords', sum(summary.get(name, 0) for name in QUADRANTS) == len(rows),
            {'summary': summary, 'rows': len(rows)})
    if group_id is not None:
        require('the group has keywords', len(rows) > 0, body)
        require('every keyword of the group has Google AI Overviews data', summary.get('no_data') == 0,
                [row['keyword'] for row in rows if row.get('quadrant') == 'no_data'])


def check_lists(api: LiveApi) -> None:
    for name, path, key in LIST_ROUTES:
        status, body = api.call(FUNCTION, api_event('GET', path))
        expect(name, status, body, 200)
        require(f'{name} carry "{key}"', key in body, sorted(body))


def check_domain_snapshots(api: LiveApi) -> None:
    """The stored traffic snapshots of the brand's first own domain (Settings > Brand Tracking)."""
    status, body = api.call(FUNCTION, api_event('GET', '/api/seo/rank-trackers'))
    owned = expect('the own domains of Brand Tracking', status, body, 200).get('owned_domains') or []
    require('Brand Tracking names an own domain', len(owned) > 0, body.get('owned_domains'))
    query = {'domain': owned[0]}
    status, body = api.call(FUNCTION, api_event('GET', '/api/seo/domains/snapshots', query=query))
    expect(f'Domain Overview traffic snapshots of {owned[0]}', status, body, 200)
    require('the snapshots answer carries "snapshots"', 'snapshots' in body, sorted(body))


def run(api: LiveApi, group_id: str | None) -> None:
    check_account(api)
    check_seo_geo(api, None)
    if group_id is not None:
        check_seo_geo(api, group_id)
    check_lists(api)
    check_domain_snapshots(api)


def main() -> int:
    parser = argparse.ArgumentParser(description="Live end-to-end check of the SEO pages' data (free routes only).")
    parser.add_argument('--region', default='us-west-2')
    parser.add_argument('--group', help='A keyword group whose keywords must have Google AI Overviews data')
    args = parser.parse_args()
    try:
        run(LiveApi(args.region), args.group)
    except E2EFailureError as failure:
        print(f'FAIL {failure}', file=sys.stderr)
        return 1
    print('PASS SEO pages')
    return 0


if __name__ == '__main__':
    sys.exit(main())
