#!/bin/bash

# Clear CloudFront cache after deployment
# This script retrieves the CloudFront distribution ID from CDK outputs
# and creates a cache invalidation

set -e

echo "🔍 Getting CloudFront Distribution ID from CDK outputs..."

# Get the distribution ID from CloudFormation stack outputs
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name CitationAnalysisStack \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)

if [ -z "$DISTRIBUTION_ID" ]; then
  echo "❌ Error: Could not find CloudFront Distribution ID in stack outputs"
  echo "   Make sure the stack is deployed and the output exists"
  exit 1
fi

echo "✅ Found Distribution ID: $DISTRIBUTION_ID"
echo "🔄 Creating cache invalidation..."

# Create invalidation
INVALIDATION_OUTPUT=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --output json)

INVALIDATION_ID=$(echo "$INVALIDATION_OUTPUT" | jq -r '.Invalidation.Id')

echo "✅ Cache invalidation created: $INVALIDATION_ID"
echo "⏳ Status: InProgress"
echo ""
echo "💡 To check invalidation status, run:"
echo "   aws cloudfront get-invalidation --distribution-id $DISTRIBUTION_ID --id $INVALIDATION_ID"
echo ""
echo "🌐 Dashboard URL: https://$(aws cloudformation describe-stacks \
  --stack-name CitationAnalysisStack \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardUrl'].OutputValue" \
  --output text | sed 's|https://||')"
