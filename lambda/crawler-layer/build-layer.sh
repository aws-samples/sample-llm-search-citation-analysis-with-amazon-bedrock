#!/bin/bash

# Build the Crawler Lambda Layer: AgentCore SDK + Playwright CDP client.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LAYER_DIR="python"
BUILT_WITH_DOCKER=false

echo "Building Crawler Lambda Layer (Browser Tools)..."
rm -rf "$LAYER_DIR"
mkdir -p "$LAYER_DIR"

if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    BUILT_WITH_DOCKER=true
    echo "Using Docker to build for Linux compatibility..."
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
    echo "Docker not running - using pip with Linux/Python 3.12 wheel constraints"
    # greenlet (a Playwright dependency) ships no manylinux2014 wheel for
    # cp312, only manylinux_2_28; the Lambda Python 3.12 runtime (AL2023,
    # glibc 2.34) accepts both tags.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pip3 install \
        -r requirements.txt \
        -t "$LAYER_DIR" \
        --platform manylinux2014_x86_64 \
        --platform manylinux_2_28_x86_64 \
        --only-binary=:all: \
        --python-version 3.12 \
        --upgrade \
        --no-cache-dir
    echo "Cross-platform build completed"
fi

# Copy first-party modules after dependencies so source always wins.
echo "Copying shared modules..."
mkdir -p "$LAYER_DIR/shared"
find ../shared -maxdepth 1 -name '*.py' ! -name 'test_*' -exec cp {} "$LAYER_DIR/shared/" \;
touch "$LAYER_DIR/shared/__init__.py"

# Browser downloads are unnecessary and can push the layer over Lambda's
# uncompressed-size limit. Fail the build if Playwright ever adds one.
if find "$LAYER_DIR" -type d -name '.local-browsers' -print -quit | grep -q .; then
    echo "Browser binaries found in crawler layer; PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD was not honored" >&2
    exit 1
fi

# Import inside the actual Lambda Python 3.12 image. This also proves the
# bundled AWS SDK satisfies the pinned AgentCore requirement instead of
# accidentally relying on the older SDK under /var/runtime.
if [ "$BUILT_WITH_DOCKER" = true ]; then
    echo "Running Lambda-runtime import smoke test..."
    docker run --rm \
        --platform linux/amd64 \
        --entrypoint python \
        -v "$(pwd)/$LAYER_DIR":/opt/python:ro \
        -e PYTHONPATH=/opt/python \
        -e AWS_EC2_METADATA_DISABLED=true \
        -e AWS_ACCESS_KEY_ID=smoke \
        -e AWS_SECRET_ACCESS_KEY=smoke \
        public.ecr.aws/lambda/python:3.12 \
        -c "import boto3, botocore, inspect, os; from bedrock_agentcore.tools.browser_client import BrowserClient; from playwright.sync_api import sync_playwright; size = sum(os.path.getsize(os.path.join(root, name)) for root, _, names in os.walk('/opt/python') for name in names); assert size < 250 * 1024 * 1024, f'crawler layer is {size} bytes'; assert boto3.__version__ == '1.43.98'; assert botocore.__version__ == '1.43.98'; client = BrowserClient(region='us-west-2'); required = {'identifier', 'name', 'session_timeout_seconds'}; assert required <= set(inspect.signature(client.start).parameters); assert callable(client.generate_ws_headers); assert callable(client.stop); assert sync_playwright"
else
    echo "Skipping Lambda-runtime import smoke test because Docker is unavailable"
fi

echo ""
echo "Layer contents:"
ls -la "$LAYER_DIR/" | head -20
echo ""
echo "Shared modules:"
ls -la "$LAYER_DIR/shared/"
echo ""
echo "Layer size:"
du -sh "$LAYER_DIR/"
echo ""
echo "Crawler Lambda Layer built successfully"
