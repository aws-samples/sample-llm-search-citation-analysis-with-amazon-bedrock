#!/bin/bash

# Build script for Lambda Layer
# This script packages Python dependencies and shared code into a Lambda Layer structure
# Uses Docker to ensure Linux compatibility for Lambda runtime

set -e

# Resolve to this script's directory before any destructive step. Without it,
# the `rm -rf $LAYER_DIR` below is relative to the caller's cwd. The crawler
# layer's sibling script already does this.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building Lambda Layer for AWS Lambda (Linux)..."

# Create layer directory structure
LAYER_DIR="python"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

# Both branches must produce x86_64 Linux wheels, because that is what the
# Lambda runtime loads. Previously neither did (AUDIT-2026-08-19 §1.6):
#
#   - The Docker branch omitted `--platform linux/amd64`, so on Apple Silicon
#     `public.ecr.aws/lambda/python:3.12` resolves to the arm64 manifest and
#     built arm64 wheels.
#   - The pip fallback had no --platform/--python-version/--only-binary at all,
#     so it built for whatever the host happens to be.
#
# This layer carries compiled wheels (e.g. beautifulsoup4's dependencies);
# nothing downstream checks the platform, so a wrong one surfaces as an
# ImportError inside every Lambda. Flags
# mirror lambda/crawler-layer/build-layer.sh, which already got this right.
USE_DOCKER=false
if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    USE_DOCKER=true
    echo "Using Docker to build for Linux compatibility..."
    
    # Use Amazon Linux 2023 image (matches Lambda Python 3.12 runtime)
    # --platform linux/amd64 ensures x86_64 compatibility (Lambda default)
    # As the calling user: on Linux, files a root container writes cannot be removed by the host user
    # (the rm of python/bin below, a rebuild). HOME=/tmp gives pip a writable home.
    docker run --rm \
        --platform linux/amd64 \
        --user "$(id -u):$(id -g)" -e HOME=/tmp \
        --entrypoint "" \
        -v "$(pwd)":/var/task \
        -w /var/task \
        public.ecr.aws/lambda/python:3.12 \
        pip install -r requirements.txt -t python/ --upgrade --no-cache-dir --no-compile
    
    echo "Docker build completed"
else
    echo "⚠️  Docker not running - using pip with --platform for Linux cross-compilation"
    # --only-binary=:all: is what makes this hermetic: it refuses to fall back
    # to building a source distribution against the host toolchain, which is
    # how a host-native binary would slip in unnoticed.
    pip3 install \
        -r requirements.txt \
        -t $LAYER_DIR \
        --platform manylinux2014_x86_64 \
        --only-binary=:all: \
        --python-version 3.12 \
        --upgrade \
        --no-cache-dir \
        --no-compile
    echo "Cross-platform build completed"
fi

# pip's console scripts (bin/) are never run on Lambda (python/bin is not on
# PATH) and their shebang names the installing interpreter, so the Docker and
# pip builds of the same wheels differed only there. Drop them.
rm -rf "${LAYER_DIR:?}/bin"

# Copy shared Python modules (exclude test files from deployed layer)
echo "Copying shared modules..."
mkdir -p $LAYER_DIR/shared
find ../shared -maxdepth 1 -name '*.py' ! -name 'test_*' -exec cp {} $LAYER_DIR/shared/ \;

# Create __init__.py files to make it a proper package
touch $LAYER_DIR/shared/__init__.py

# Ship CPython 3.12 bytecode: /opt is read-only on Lambda, so without it every
# cold start recompiles each imported module. pip runs with --no-compile above
# so only this deterministic, version-checked pass writes .pyc files.
echo "Precompiling bytecode with CPython 3.12..."
if [ "$USE_DOCKER" = true ]; then
    bash ../../scripts/compile-python312.sh --docker "$LAYER_DIR" shared
else
    bash ../../scripts/compile-python312.sh "$LAYER_DIR" shared
fi

echo "Lambda Layer built successfully in $LAYER_DIR/"
echo ""
echo "Layer structure:"
find "$LAYER_DIR" -mindepth 1 -maxdepth 1 | sort | head -20
echo ""
echo "Shared modules:"
ls -la $LAYER_DIR/shared/

echo ""
echo "✅ Lambda Layer is ready for deployment"
