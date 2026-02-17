#!/bin/bash

# Build script for Crawler Lambda Layer (Browser Tools)
# This layer contains Playwright + AgentCore SDK for browser automation
# Playwright is installed WITHOUT browser binaries (uses AgentCore managed browsers)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building Crawler Lambda Layer (Browser Tools)..."

LAYER_DIR="python"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

# Check if Docker is available and running
if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    echo "Using Docker to build for Linux compatibility..."
    
    # Use Amazon Linux 2023 image (matches Lambda Python 3.12 runtime)
    # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 prevents downloading 400MB+ of browsers
    # --platform linux/amd64 ensures x86_64 compatibility (Lambda default)
    docker run --rm \
        --platform linux/amd64 \
        --entrypoint "" \
        -v "$(pwd)":/var/task \
        -w /var/task \
        -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
        public.ecr.aws/lambda/python:3.12 \
        pip install -r requirements.txt -t python/ --upgrade --no-cache-dir
    
    echo "Docker build completed"
else
    echo "⚠️  Docker not running - using pip with --platform for Linux cross-compilation"
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pip3 install \
        -r requirements.txt \
        -t $LAYER_DIR \
        --platform manylinux2014_x86_64 \
        --only-binary=:all: \
        --python-version 3.12 \
        --upgrade \
        --no-cache-dir
    echo "Cross-platform build completed"
fi

# Remove boto3/botocore - they're provided by Lambda runtime
# This saves ~27MB
echo "Removing boto3/botocore (provided by Lambda runtime)..."
rm -rf $LAYER_DIR/boto3 $LAYER_DIR/boto3-*.dist-info
rm -rf $LAYER_DIR/botocore $LAYER_DIR/botocore-*.dist-info
rm -rf $LAYER_DIR/s3transfer $LAYER_DIR/s3transfer-*.dist-info
rm -rf $LAYER_DIR/jmespath $LAYER_DIR/jmespath-*.dist-info

# Copy shared Python modules (exclude test files from deployed layer)
echo "Copying shared modules..."
mkdir -p $LAYER_DIR/shared
find ../shared -maxdepth 1 -name '*.py' ! -name 'test_*' -exec cp {} $LAYER_DIR/shared/ \;
touch $LAYER_DIR/shared/__init__.py

# Show layer size
echo ""
echo "Layer contents:"
ls -la $LAYER_DIR/ | head -20
echo ""
echo "Shared modules:"
ls -la $LAYER_DIR/shared/
echo ""
echo "Layer size:"
du -sh $LAYER_DIR/

echo ""
echo "✅ Crawler Lambda Layer built successfully"
