#!/bin/bash

# Citation Analysis System - Automated Deployment Script
# This script automates the deployment of the entire system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo "=========================================="
    echo "$1"
    echo "=========================================="
    echo ""
}

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    local all_good=true
    
    # Check Node.js
    if command_exists node; then
        local node_version=$(node --version)
        print_success "Node.js installed: $node_version"
    else
        print_error "Node.js is not installed. Please install Node.js 20+ first."
        all_good=false
    fi
    
    # Check npm
    if command_exists npm; then
        local npm_version=$(npm --version)
        print_success "npm installed: $npm_version"
    else
        print_error "npm is not installed."
        all_good=false
    fi
    
    # Check Python
    if command_exists python3; then
        local python_version=$(python3 --version)
        print_success "Python installed: $python_version"
    else
        print_error "Python 3 is not installed. Please install Python 3.12+."
        all_good=false
    fi
    
    # Check pip
    if command_exists pip3; then
        local pip_version=$(pip3 --version)
        print_success "pip installed: $pip_version"
    else
        print_error "pip3 is not installed."
        all_good=false
    fi
    
    # Check AWS CLI
    if command_exists aws; then
        local aws_version=$(aws --version)
        print_success "AWS CLI installed: $aws_version"
    else
        print_error "AWS CLI is not installed. Please install it first."
        all_good=false
    fi
    
    # Check CDK CLI
    if command_exists cdk; then
        local cdk_version=$(cdk --version)
        print_success "AWS CDK installed: $cdk_version"
    else
        print_error "AWS CDK is not installed. Run: npm install -g aws-cdk"
        all_good=false
    fi
    
    # Check AWS credentials
    if aws sts get-caller-identity &> /dev/null; then
        local account_id=$(aws sts get-caller-identity --query Account --output text)
        local region=$(aws configure get region || echo "not set")
        print_success "AWS credentials configured"
        print_info "  Account ID: $account_id"
        print_info "  Region: $region"
    else
        print_error "AWS credentials not configured. Run: aws configure"
        all_good=false
    fi
    
    if [ "$all_good" = false ]; then
        print_error "Prerequisites check failed. Please fix the issues above."
        exit 1
    fi
    
    print_success "All prerequisites satisfied!"
}

# Function to install Node.js dependencies
install_node_dependencies() {
    print_header "Installing Node.js Dependencies"
    
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
    
    print_info "Running npm install..."
    npm install
    
    print_success "Node.js dependencies installed"
}

# Function to install Python dependencies
install_python_dependencies() {
    print_header "Installing Python Dependencies"
    
    # Install dependencies for each Lambda function
    local lambda_dirs=("search" "deduplication" "crawler" "parse-keywords" "generate-summary")
    
    for dir in "${lambda_dirs[@]}"; do
        local lambda_path="lambda/$dir"
        
        if [ -d "$lambda_path" ] && [ -f "$lambda_path/requirements.txt" ]; then
            print_info "Installing dependencies for $dir Lambda..."
            
            # Create a temporary directory for dependencies
            local temp_dir="$lambda_path/.deps"
            rm -rf "$temp_dir"
            mkdir -p "$temp_dir"
            
            # Install dependencies
            pip3 install -r "$lambda_path/requirements.txt" -t "$temp_dir" --quiet
            
            print_success "Dependencies installed for $dir Lambda"
        else
            print_warning "Skipping $dir Lambda (not found or no requirements.txt)"
        fi
    done
    
    print_success "All Python dependencies installed"
}

# Function to build Lambda Layers
build_lambda_layers() {
    print_header "Building Lambda Layers"
    
    # Build shared layer (API utilities, config, decorators)
    if [ -f "lambda/layer/build-layer.sh" ]; then
        print_info "Building Shared Lambda Layer..."
        cd lambda/layer
        bash build-layer.sh
        cd ../..
        print_success "Shared Lambda Layer built successfully"
    else
        print_warning "Shared Lambda Layer build script not found, skipping..."
    fi
    
    # Build crawler layer (Playwright + Bedrock AgentCore)
    if [ -f "lambda/crawler-layer/build-layer.sh" ]; then
        print_info "Building Crawler Lambda Layer (this may take a minute)..."
        cd lambda/crawler-layer
        bash build-layer.sh
        cd ../..
        print_success "Crawler Lambda Layer built successfully"
    else
        print_warning "Crawler Lambda Layer build script not found, skipping..."
    fi
}

# Function to build web dashboard
build_web_dashboard() {
    print_header "Building Web Dashboard"
    
    if [ -f "scripts/build-web.sh" ]; then
        print_info "Building React + TypeScript dashboard..."
        bash scripts/build-web.sh
        print_success "Web dashboard built successfully"
    else
        print_warning "Web build script not found, skipping..."
    fi
}

# Function to build TypeScript
build_typescript() {
    print_header "Building TypeScript"
    
    print_info "Compiling TypeScript..."
    npm run build
    
    print_success "TypeScript compiled successfully"
}

# Function to check CDK bootstrap
check_cdk_bootstrap() {
    print_header "Checking CDK Bootstrap"
    
    local account_id=$(aws sts get-caller-identity --query Account --output text)
    local region=$(aws configure get region || echo "us-east-1")
    
    print_info "Checking if CDK is bootstrapped in account $account_id, region $region..."
    
    # Check if CDK bootstrap stack exists
    if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$region" &> /dev/null; then
        print_success "CDK is already bootstrapped"
    else
        print_warning "CDK is not bootstrapped in this account/region"
        read -p "Would you like to bootstrap CDK now? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_info "Bootstrapping CDK..."
            cdk bootstrap
            print_success "CDK bootstrapped successfully"
        else
            print_error "CDK bootstrap is required. Please run: cdk bootstrap"
            exit 1
        fi
    fi
}

# Function to synthesize CDK stack
synthesize_stack() {
    print_header "Synthesizing CDK Stack"
    
    print_info "Generating CloudFormation template..."
    cdk synth > /dev/null
    
    print_success "CloudFormation template synthesized"
}

# Function to deploy CDK stack
deploy_stack() {
    print_header "Deploying CDK Stack"
    
    print_info "Starting CDK deployment..."
    print_warning "This may take several minutes..."
    
    # Deploy with auto-approval
    cdk deploy --require-approval never
    
    print_success "CDK stack deployed successfully!"
}

# Function to rebuild frontend with Cognito config
rebuild_frontend_with_cognito() {
    print_header "Rebuilding Frontend with Cognito Configuration"
    
    print_info "Fetching Cognito configuration from CloudFormation..."
    
    # Check if stack exists and has Cognito outputs
    local user_pool_id=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$user_pool_id" ] || [ "$user_pool_id" = "None" ]; then
        print_warning "Cognito configuration not found in stack outputs, skipping frontend rebuild"
        return 0
    fi
    
    print_info "Cognito User Pool found, rebuilding frontend..."
    
    # Rebuild web dashboard with Cognito config (build-web.sh fetches all IDs from CloudFormation)
    if [ ! -f "scripts/build-web.sh" ]; then
        print_error "scripts/build-web.sh not found, cannot rebuild frontend"
        return 1
    fi
    
    bash scripts/build-web.sh
    print_success "Frontend rebuilt with Cognito configuration"
    
    # Get bucket name from CloudFormation output
    local bucket_name=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`WebBucketName`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$bucket_name" ] || [ "$bucket_name" = "None" ]; then
        # Fallback to constructed name
        local account_id=$(aws sts get-caller-identity --query Account --output text)
        bucket_name="citation-analysis-web-${account_id}"
        print_warning "WebBucketName output not found, using constructed name: ${bucket_name}"
    fi
    
    # Upload updated frontend to S3
    if [ -d "web/dist" ]; then
        print_info "Uploading updated frontend to S3 (${bucket_name})..."
        aws s3 sync web/dist/ "s3://${bucket_name}/" --delete
        print_success "Updated frontend uploaded to S3"
    else
        print_error "web/dist not found — build may have failed"
        return 1
    fi
    
    # Clear CloudFront cache
    print_info "Clearing CloudFront cache..."
    local dist_id=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$dist_id" ] && [ "$dist_id" != "None" ]; then
        aws cloudfront create-invalidation \
            --distribution-id "$dist_id" \
            --paths "/*" > /dev/null 2>&1
        print_success "CloudFront cache cleared"
        print_info "Cache invalidation may take 30-60 seconds to propagate"
    else
        print_warning "CloudFront Distribution ID not found, skipping cache invalidation"
    fi
}

# Function to verify deployment
verify_deployment() {
    print_header "Verifying Deployment"
    
    local stack_name="CitationAnalysisStack"
    local region=$(aws configure get region || echo "us-east-1")
    
    print_info "Checking stack status..."
    
    if aws cloudformation describe-stacks --stack-name "$stack_name" --region "$region" &> /dev/null; then
        local stack_status=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --region "$region" \
            --query 'Stacks[0].StackStatus' \
            --output text)
        
        if [ "$stack_status" = "CREATE_COMPLETE" ] || [ "$stack_status" = "UPDATE_COMPLETE" ]; then
            print_success "Stack status: $stack_status"
            
            # Get stack outputs
            print_info "Stack outputs:"
            aws cloudformation describe-stacks \
                --stack-name "$stack_name" \
                --region "$region" \
                --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
                --output table
            
            # Verify DynamoDB tables
            print_info "Verifying DynamoDB tables..."
            local tables=("SearchResults" "Citations" "CrawledContent")
            for table in "${tables[@]}"; do
                if aws dynamodb describe-table --table-name "CitationAnalysis-$table" --region "$region" &> /dev/null; then
                    print_success "  ✓ Table exists: CitationAnalysis-$table"
                else
                    print_warning "  ✗ Table not found: CitationAnalysis-$table"
                fi
            done
            
            # Verify Secrets Manager secrets
            print_info "Verifying Secrets Manager secrets..."
            local secrets=("openai-key" "perplexity-key" "gemini-key" "claude-key")
            for secret in "${secrets[@]}"; do
                if aws secretsmanager describe-secret --secret-id "citation-analysis/$secret" --region "$region" &> /dev/null; then
                    print_success "  ✓ Secret exists: citation-analysis/$secret"
                else
                    print_warning "  ✗ Secret not found: citation-analysis/$secret"
                fi
            done
            
            # Verify Lambda functions
            print_info "Verifying Lambda functions..."
            local functions=("Search" "Deduplication" "Crawler" "ParseKeywords" "GenerateSummary")
            for func in "${functions[@]}"; do
                if aws lambda get-function --function-name "CitationAnalysis-$func" --region "$region" &> /dev/null; then
                    print_success "  ✓ Lambda exists: CitationAnalysis-$func"
                else
                    print_warning "  ✗ Lambda not found: CitationAnalysis-$func"
                fi
            done
            
            # Verify Step Functions state machine
            print_info "Verifying Step Functions state machine..."
            local state_machines=$(aws stepfunctions list-state-machines --region "$region" --query "stateMachines[?contains(name, 'CitationAnalysis')].name" --output text)
            if [ -n "$state_machines" ]; then
                print_success "  ✓ State machine exists: $state_machines"
            else
                print_warning "  ✗ State machine not found"
            fi
            
        else
            print_error "Stack status: $stack_status"
            print_error "Deployment may have failed. Check AWS Console for details."
            exit 1
        fi
    else
        print_error "Stack not found: $stack_name"
        exit 1
    fi
    
    print_success "Deployment verification complete!"
}

# Function to invalidate CloudFront cache
invalidate_cloudfront_cache() {
    print_header "Invalidating CloudFront Cache"
    
    local distribution_id=$(aws cloudformation describe-stacks \
        --stack-name CitationAnalysisStack \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
        --output text 2>/dev/null)
    
    if [ -n "$distribution_id" ] && [ "$distribution_id" != "None" ]; then
        print_info "Creating cache invalidation for distribution: $distribution_id"
        
        local invalidation_id=$(aws cloudfront create-invalidation \
            --distribution-id "$distribution_id" \
            --paths "/*" \
            --query 'Invalidation.Id' \
            --output text 2>/dev/null)
        
        if [ -n "$invalidation_id" ]; then
            print_success "Cache invalidation created: $invalidation_id"
            print_info "Invalidation is in progress (usually takes 1-2 minutes)"
        else
            print_warning "Failed to create cache invalidation"
        fi
    else
        print_warning "CloudFront distribution ID not found, skipping cache invalidation"
    fi
}

# Function to display next steps
display_next_steps() {
    print_header "Deployment Complete"
    
    echo "Your Citation Analysis System has been deployed successfully!"
    echo ""
    echo "📊 Dashboard URL:"
    local dashboard_url=$(aws cloudformation describe-stacks --stack-name CitationAnalysisStack --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' --output text 2>/dev/null)
    if [ -n "$dashboard_url" ]; then
        echo "   $dashboard_url"
        echo ""
    fi
    echo "To get started:"
    echo ""
    echo "1. Open the dashboard URL above"
    echo ""
    echo "2. Create a user account via AWS CLI:"
    echo "   aws cognito-idp admin-create-user --user-pool-id <pool-id> --username user@example.com --user-attributes Name=email,Value=user@example.com --desired-delivery-mediums EMAIL"
    echo ""
    echo "3. Log in and go to Settings > Providers to add your API keys"
    echo "   (OpenAI, Perplexity, Gemini, Claude)"
    echo ""
    echo "4. Add keywords in the Keywords section"
    echo ""
    echo "5. Trigger an analysis run from the dashboard"
    echo ""
    echo "For more information, see the README.md file."
    echo ""
}

# Main execution
main() {
    print_header "Citation Analysis System - Automated Deployment"
    
    # Change to script directory
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    cd "$SCRIPT_DIR/.."
    
    print_info "Working directory: $(pwd)"
    
    # Run deployment steps
    check_prerequisites
    install_node_dependencies
    install_python_dependencies
    build_lambda_layers
    build_web_dashboard
    build_typescript
    check_cdk_bootstrap
    synthesize_stack
    deploy_stack
    rebuild_frontend_with_cognito
    verify_deployment
    invalidate_cloudfront_cache
    display_next_steps
    
    print_success "Deployment complete! 🎉"
}

# Run main function
main
