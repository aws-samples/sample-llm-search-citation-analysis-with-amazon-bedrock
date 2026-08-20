#!/bin/bash

# Deploy web dashboard only (build, sync to S3, invalidate CloudFront cache)
# Use this for quick frontend-only deployments without CDK

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Change to project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Step 1: Build the web dashboard
print_info "Building web dashboard..."
bash scripts/build-web.sh

# Step 2: Get S3 bucket name from CloudFormation
print_info "Getting S3 bucket name from CloudFormation..."
BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name CitationAnalysisStack \
    --query 'Stacks[0].Outputs[?OutputKey==`WebBucketName`].OutputValue' \
    --output text 2>/dev/null)

# No constructed-name fallback: step 3 runs `aws s3 sync --delete`, so guessing
# a bucket name when the stack output is missing would wipe whatever bucket owns
# that name. webBucket is unversioned, so recovery would be manual
# (AUDIT-2026-08-19 §1.5).
if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
    print_error "WebBucketName output not found on stack CitationAnalysisStack."
    print_error "Refusing to run 'aws s3 sync --delete' against a guessed bucket name."
    exit 1
fi

print_info "Found bucket name: $BUCKET_NAME"

# Step 3: Sync to S3
print_info "Syncing web/dist to S3..."
aws s3 sync web/dist "s3://${BUCKET_NAME}" --delete

print_success "Files uploaded to S3"

# Step 4: Invalidate CloudFront cache
print_info "Invalidating CloudFront cache..."
bash scripts/clear-cloudfront-cache.sh

print_success "Web dashboard deployed! 🎉"
