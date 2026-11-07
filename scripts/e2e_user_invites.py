#!/usr/bin/env python3
"""
Live end-to-end check of the user invite flow on a deployed stack (``npm run e2e:users``).

It does what an Admin does in Settings > Users, against the real ``CitationAnalysis-API-ManageUsers`` Lambda and
the real Cognito user pool:

1. invite a throwaway user (``POST /api/users``);
2. resend the invitation by the user's ``username`` as the dashboard lists it - the pool signs in by email, so that
   is the internal id (the ``sub``), the case that answered a 500 on 2026-10-26 (``POST /api/users/{username}/
   reset-password`` must answer 200 ``invite_resent``);
3. delete the user again (``DELETE /api/users/{username}``), also when a step fails.

Each run sends two real emails, to the Amazon SES mailbox simulator (``success+e2e-<time>@simulator.amazonses.com``),
which accepts them and delivers nothing; they count towards the pool's daily email quota (50 a day with Cognito's
default sender). Not part of ``npm run validate``: it needs AWS credentials and a deployed stack.

Usage: ``.venv/bin/python scripts/e2e_user_invites.py [--region us-west-2] [--function CitationAnalysis-API-ManageUsers]``
"""

from __future__ import annotations

import argparse
import sys
import time
from urllib.parse import quote

from e2e_live import E2EFailureError, LiveApi, api_event, expect, require

FUNCTION = 'CitationAnalysis-API-ManageUsers'


def user_event(method: str, username: str, suffix: str = '', body: dict | None = None) -> dict:
    """An Admin event for ``/api/users/{username}<suffix>``."""
    return api_event(method, f'/api/users/{quote(username, safe="")}{suffix}', body,
                     resource=f'/api/users/{{username}}{suffix}', path_params={'username': username})


def run(api: LiveApi, function: str) -> None:
    email = f'success+e2e-{int(time.time())}@simulator.amazonses.com'
    status, body = api.call(function, api_event('POST', '/api/users', {'email': email, 'groups': ['Users']}))
    username = expect('invite a new user', status, body, 200)['user']['username']
    try:
        status, body = api.call(function, user_event('POST', username, '/reset-password', {}))
        expect('resend the pending invite by its listed username', status, body, 200)
        require('the resend went out as an invitation', body.get('action') == 'invite_resent', body)
    finally:
        status, body = api.call(function, user_event('DELETE', username))
        expect('delete the test user', status, body, 200)


def main() -> int:
    parser = argparse.ArgumentParser(description='Live end-to-end check of the user invite flow on a deployed stack.')
    parser.add_argument('--region', default='us-west-2')
    parser.add_argument('--function', default=FUNCTION)
    args = parser.parse_args()
    try:
        run(LiveApi(args.region), args.function)
    except E2EFailureError as failure:
        print(f'FAIL {failure}', file=sys.stderr)
        return 1
    print('PASS user invite flow')
    return 0


if __name__ == '__main__':
    sys.exit(main())
