#!/bin/bash

# Build the web dashboard
# Automatically fetches API Gateway URL and Cognito IDs from CloudFormation stack,
# and the MCP server URL and client id from CitationAnalysisMcpStack when it exists
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

    # MCP server (optional stack CitationAnalysisMcpStack): the "Connect an AI
    # assistant" page shows its URL and client id, and says the server isn't
    # deployed when they are missing, so a missing stack is not an error.
    MCP_URL=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisMcpStack \
        --query 'Stacks[0].Outputs[?OutputKey==`McpUrl`].OutputValue' \
        --output text 2>/dev/null || echo "")

    MCP_CLIENT_ID=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisMcpStack \
        --query 'Stacks[0].Outputs[?OutputKey==`McpClientId`].OutputValue' \
        --output text 2>/dev/null || echo "")

    if [ -n "$MCP_URL" ] && [ "$MCP_URL" != "None" ] && [ -n "$MCP_CLIENT_ID" ] && [ "$MCP_CLIENT_ID" != "None" ]; then
        echo "Found MCP server URL: $MCP_URL"
        export VITE_MCP_URL="$MCP_URL"
        export VITE_MCP_CLIENT_ID="$MCP_CLIENT_ID"
    else
        echo "ℹ️  MCP stack outputs not found: the AI Assistants page will say the MCP server isn't deployed"
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
