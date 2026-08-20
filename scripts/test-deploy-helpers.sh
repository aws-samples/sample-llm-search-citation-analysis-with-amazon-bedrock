#!/usr/bin/env bash
# Unit tests for the pure helpers in scripts/deploy.sh.
#
# deploy.sh guards its `main` call with a BASH_SOURCE check, so this file can
# source it and call individual functions with a stubbed `aws`.
#
# Covers AUDIT-2026-08-19 §1.4: region resolution must follow the same
# precedence the AWS CLI does and hard-fail rather than guessing "us-east-1",
# because a wrong region made verification report every resource missing while
# still declaring success.
#
# Usage: scripts/test-deploy-helpers.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./deploy.sh
source "$SCRIPT_DIR/deploy.sh"

TESTS_RUN=0
TESTS_FAILED=0

# Stub the AWS CLI. `AWS_CONFIG_REGION` stands in for what
# `aws configure get region` would read out of ~/.aws/config: empty means the
# real CLI would print nothing and exit non-zero.
aws() {
    if [ "$1" = "configure" ] && [ "$2" = "get" ] && [ "$3" = "region" ]; then
        if [ -n "${AWS_CONFIG_REGION:-}" ]; then
            printf '%s' "$AWS_CONFIG_REGION"
            return 0
        fi
        return 1
    fi
    return 0
}

expect_region() {
    local description="$1"
    local expected="$2"
    local actual
    TESTS_RUN=$((TESTS_RUN + 1))

    actual=$(resolve_region 2>/dev/null || printf '<failed>')

    if [ "$actual" = "$expected" ]; then
        echo "  ok   — $description"
    else
        echo "  FAIL — $description (expected '$expected', got '$actual')"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

expect_resolve_fails() {
    local description="$1"
    TESTS_RUN=$((TESTS_RUN + 1))

    if resolve_region >/dev/null 2>&1; then
        echo "  FAIL — $description (expected non-zero exit)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    else
        echo "  ok   — $description"
    fi
}

echo "resolve_region"

AWS_CONFIG_REGION='eu-west-1'
unset AWS_REGION AWS_DEFAULT_REGION
expect_region "uses the configured profile region" 'eu-west-1'

AWS_CONFIG_REGION=''
AWS_REGION='ap-southeast-2'
unset AWS_DEFAULT_REGION
expect_region "falls back to AWS_REGION when the profile has none" 'ap-southeast-2'

AWS_CONFIG_REGION=''
unset AWS_REGION
AWS_DEFAULT_REGION='us-west-2'
expect_region "falls back to AWS_DEFAULT_REGION" 'us-west-2'

AWS_CONFIG_REGION=''
AWS_REGION='ap-southeast-2'
AWS_DEFAULT_REGION='us-west-2'
expect_region "prefers AWS_REGION over AWS_DEFAULT_REGION" 'ap-southeast-2'

AWS_CONFIG_REGION='eu-west-1'
AWS_REGION='ap-southeast-2'
unset AWS_DEFAULT_REGION
expect_region "prefers the profile region over the environment" 'eu-west-1'

AWS_CONFIG_REGION=''
unset AWS_REGION AWS_DEFAULT_REGION
expect_resolve_fails "fails instead of defaulting to us-east-1"

echo ""
if [ "$TESTS_FAILED" -gt 0 ]; then
    echo "FAILED: $TESTS_FAILED of $TESTS_RUN"
    exit 1
fi
echo "PASSED: $TESTS_RUN of $TESTS_RUN"
