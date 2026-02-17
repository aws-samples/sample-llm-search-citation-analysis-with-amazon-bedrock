#!/bin/bash

# Build script for Lambda Layer
# This script packages Python dependencies and shared code into a Lambda Layer structure
# Uses Docker to ensure Linux compatibility for Lambda runtime

set -e

echo "Building Lambda Layer for AWS Lambda (Linux)..."

# Create layer directory structure
LAYER_DIR="python"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

# Check if Docker is available and running
if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "Using Docker to build for Linux compatibility..."
    
    # Use Amazon Linux 2023 image (matches Lambda Python 3.12 runtime)
    docker run --rm \
        --entrypoint "" \
        -v "$(pwd)":/var/task \
        -w /var/task \
        -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
        public.ecr.aws/lambda/python:3.12 \
        pip install -r requirements.txt -t python/ --upgrade
    
    echo "Docker build completed"
else
    echo "⚠️  Docker not available or not running - building with local pip"
    echo "For production, ensure Docker is running and rebuild the layer"
    pip3 install -r requirements.txt -t $LAYER_DIR --upgrade
fi

# Copy shared Python modules (exclude test files from deployed layer)
echo "Copying shared modules..."
mkdir -p $LAYER_DIR/shared
find ../shared -maxdepth 1 -name '*.py' ! -name 'test_*' -exec cp {} $LAYER_DIR/shared/ \;

# Create __init__.py files to make it a proper package
touch $LAYER_DIR/shared/__init__.py

echo "Lambda Layer built successfully in $LAYER_DIR/"
echo ""
echo "Layer structure:"
ls -la $LAYER_DIR/ | head -20
echo ""
echo "Shared modules:"
ls -la $LAYER_DIR/shared/

echo ""
echo "✅ Lambda Layer is ready for deployment"
