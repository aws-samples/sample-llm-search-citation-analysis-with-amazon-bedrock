#!/bin/bash

# Deploy web dashboard only (build, sync to S3, invalidate CloudFront cache)
# Use this for quick frontend-only deployments without CDK

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
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

# Fallback: construct bucket name from account ID if output not found
if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    BUCKET_NAME="citation-analysis-web-${ACCOUNT_ID}"
    print_info "Using constructed bucket name: $BUCKET_NAME"
else
    print_info "Found bucket name: $BUCKET_NAME"
fi

# Step 3: Sync to S3
print_info "Syncing web/dist to S3..."
aws s3 sync web/dist "s3://${BUCKET_NAME}" --delete

print_success "Files uploaded to S3"

# Step 4: Invalidate CloudFront cache
print_info "Invalidating CloudFront cache..."
bash scripts/clear-cloudfront-cache.sh

print_success "Web dashboard deployed! 🎉"
