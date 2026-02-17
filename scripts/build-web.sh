#!/bin/bash

# Build the web dashboard
# Automatically fetches API Gateway URL and Cognito IDs from CloudFormation stack
set -e

echo "Building web dashboard..."

cd web

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Try to get configuration from CloudFormation
if command -v aws &> /dev/null; then
    echo "Fetching configuration from CloudFormation..."
    
    # Get API Gateway URL
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$API_URL" ] && [ "$API_URL" != "None" ]; then
        # Remove trailing slash and add /api
        API_URL="${API_URL%/}/api"
        echo "Found API URL: $API_URL"
        export VITE_API_URL="$API_URL"
    else
        echo "⚠️  Could not fetch API URL from CloudFormation"
    fi
    
    # Get Cognito User Pool ID
    USER_POOL_ID=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$USER_POOL_ID" ] && [ "$USER_POOL_ID" != "None" ]; then
        echo "Found User Pool ID: $USER_POOL_ID"
        export VITE_USER_POOL_ID="$USER_POOL_ID"
    fi
    
    # Get Cognito User Pool Client ID
    USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$USER_POOL_CLIENT_ID" ] && [ "$USER_POOL_CLIENT_ID" != "None" ]; then
        echo "Found User Pool Client ID: $USER_POOL_CLIENT_ID"
        export VITE_USER_POOL_CLIENT_ID="$USER_POOL_CLIENT_ID"
    fi
    
    # Get Cognito Identity Pool ID
    IDENTITY_POOL_ID=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`IdentityPoolId`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$IDENTITY_POOL_ID" ] && [ "$IDENTITY_POOL_ID" != "None" ]; then
        echo "Found Identity Pool ID: $IDENTITY_POOL_ID"
        export VITE_IDENTITY_POOL_ID="$IDENTITY_POOL_ID"
    fi
else
    echo "⚠️  AWS CLI not found, using fallback configuration"
fi

# Build the app
echo "Building production bundle..."

# Validate critical env vars
if [ -z "$VITE_USER_POOL_ID" ] || [ -z "$VITE_USER_POOL_CLIENT_ID" ]; then
    echo "⚠️  Cognito User Pool IDs not set — auth will not work until frontend is rebuilt after stack deployment"
fi

npm run build

echo "✅ Web dashboard built successfully!"
echo "Output: web/dist/"
