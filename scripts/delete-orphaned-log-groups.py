#!/usr/bin/env python3
"""
Delete CloudWatch log groups whose Lambda function no longer exists.

Why these exist
---------------
When a Lambda is deleted, its `/aws/lambda/<name>` log group is NOT deleted with
it. This stack consolidated ~20 one-endpoint-per-Lambda functions into five
routers, and every retired function left its log group behind — still billed,
still set to "Never expire", and impossible to write to ever again. The
2026-08-19 production audit found 26 such groups holding 57.4 MB, 79% of the
stack's total log storage.

Safety
------
Dry run by default: prints what it would delete and exits. Pass `--delete` to
act.

A group is only considered orphaned when BOTH hold:

  1. its name starts with `/aws/lambda/`, so the name maps 1:1 to a function
  2. no live Lambda function has that name

The live-function list is fetched with a paginator. This matters: `list-functions`
pages at 50 by default, and a truncated list would make live functions look
deleted and their log groups look orphaned. Getting that wrong deletes the logs
of running production functions, so the script refuses to proceed if the
function list comes back suspiciously small.

Usage
-----
    python scripts/delete-orphaned-log-groups.py                 # dry run
    python scripts/delete-orphaned-log-groups.py --delete        # act
    python scripts/delete-orphaned-log-groups.py --prefix /aws/lambda/Foo
"""

from __future__ import annotations

import argparse
import sys

import boto3
from botocore.exceptions import ClientError

LAMBDA_LOG_PREFIX = '/aws/lambda/'

# A live-function count below this is treated as a failed listing rather than a
# genuinely tiny account. Deleting on the strength of a truncated list would
# destroy logs for running functions, so erring toward refusal is correct.
MIN_PLAUSIBLE_FUNCTION_COUNT = 5


class FunctionListTooSmallError(RuntimeError):
    """Raised when the live-function list looks truncated rather than complete."""


def live_function_names(lambda_client) -> set[str]:
    """Every Lambda function name in the account, fully paginated."""
    names: set[str] = set()
    for page in lambda_client.get_paginator('list_functions').paginate():
        names.update(fn['FunctionName'] for fn in page.get('Functions', []))
    return names


def log_groups(logs_client, prefix: str) -> list[tuple[str, int]]:
    """(name, storedBytes) for every log group under `prefix`, fully paginated."""
    found: list[tuple[str, int]] = []
    paginator = logs_client.get_paginator('describe_log_groups')
    for page in paginator.paginate(logGroupNamePrefix=prefix):
        for group in page.get('logGroups', []):
            found.append((group['logGroupName'], group.get('storedBytes', 0)))
    return found


def find_orphans(
    groups: list[tuple[str, int]], functions: set[str]
) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """Split log groups into (orphaned, still_backed_by_a_live_function)."""
    orphaned, live = [], []
    for name, size in groups:
        if not name.startswith(LAMBDA_LOG_PREFIX):
            # Not a Lambda log group, so the name does not identify a function
            # and we cannot prove it is orphaned. Never a deletion candidate.
            live.append((name, size))
            continue
        function_name = name[len(LAMBDA_LOG_PREFIX):]
        (orphaned if function_name not in functions else live).append((name, size))
    return orphaned, live


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--prefix',
        default='/aws/lambda/CitationAnalysis',
        help='Log group name prefix to consider (default: %(default)s)',
    )
    parser.add_argument(
        '--delete',
        action='store_true',
        help='Actually delete. Without this the script only reports.',
    )
    args = parser.parse_args()

    logs_client = boto3.client('logs')
    lambda_client = boto3.client('lambda')

    functions = live_function_names(lambda_client)
    if len(functions) < MIN_PLAUSIBLE_FUNCTION_COUNT:
        raise FunctionListTooSmallError(
            f'Only {len(functions)} Lambda functions listed — refusing to treat '
            'log groups as orphaned on the strength of a list this short, '
            'because a truncated or failed listing would delete live logs.'
        )

    groups = log_groups(logs_client, args.prefix)
    orphaned, live = find_orphans(groups, functions)
    orphaned.sort(key=lambda item: -item[1])

    print(f'Live Lambda functions in account : {len(functions)}')
    print(f'Log groups matching {args.prefix!r} : {len(groups)}')
    print(f'  backed by a live function      : {len(live)}')
    print(f'  ORPHANED                       : {len(orphaned)}')
    print()

    if not orphaned:
        print('Nothing to delete.')
        return 0

    total = sum(size for _, size in orphaned)
    for name, size in orphaned:
        print(f'  {size:>12,}  {name}')
    print(f'\n  {len(orphaned)} groups, {total:,} bytes ({total / 1_048_576:.1f} MiB)')

    if not args.delete:
        print('\nDRY RUN — nothing deleted. Re-run with --delete to act.')
        return 0

    print('\nDeleting...')
    deleted, freed, failures = 0, 0, []
    for name, size in orphaned:
        try:
            logs_client.delete_log_group(logGroupName=name)
            deleted += 1
            freed += size
            print(f'  deleted  {name}')
        except ClientError as exc:
            code = exc.response.get('Error', {}).get('Code', 'Unknown')
            failures.append((name, code))
            print(f'  FAILED   {name} ({code})')

    print(f'\nDeleted {deleted}/{len(orphaned)} groups, freed {freed:,} bytes '
          f'({freed / 1_048_576:.1f} MiB)')
    if failures:
        print(f'{len(failures)} failed:')
        for name, code in failures:
            print(f'  {name}: {code}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
