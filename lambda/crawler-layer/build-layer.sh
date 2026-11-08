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
    # As the calling user: on Linux, files a root container writes cannot be removed by the host user
    # (the rm of python/bin below, a rebuild). HOME=/tmp gives pip a writable home.
    docker run --rm \
        --platform linux/amd64 \
        --user "$(id -u):$(id -g)" -e HOME=/tmp \
        --entrypoint "" \
        -v "$(pwd)":/var/task \
        -w /var/task \
        -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
        public.ecr.aws/lambda/python:3.12 \
        pip install -r requirements.txt -t python/ --upgrade --no-cache-dir --no-compile
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
        --no-cache-dir \
        --no-compile
    echo "Cross-platform build completed"
fi

# pip's console scripts (bin/) are never run on Lambda (python/bin is not on
# PATH) and their shebang names the installing interpreter, so the Docker and
# pip builds of the same wheels differed only there. Drop them.
rm -rf "${LAYER_DIR:?}/bin"

# Copy first-party modules after dependencies so source always wins.
echo "Copying shared modules..."
mkdir -p "$LAYER_DIR/shared"
find ../shared -maxdepth 1 -name '*.py' ! -name 'test_*' -exec cp {} "$LAYER_DIR/shared/" \;
touch "$LAYER_DIR/shared/__init__.py"

# Ship CPython 3.12 bytecode for everything, the bundled boto3/botocore and
# Playwright included: /opt is read-only on Lambda, so without it every cold
# start recompiles each imported module. pip runs with --no-compile above so
# only this deterministic, version-checked pass writes .pyc files.
echo "Precompiling bytecode with CPython 3.12..."
if [ "$BUILT_WITH_DOCKER" = true ]; then
    bash ../../scripts/compile-python312.sh --docker "$LAYER_DIR" shared
else
    bash ../../scripts/compile-python312.sh "$LAYER_DIR" shared
fi

# Lambda caps a function's code plus layers at 250 MB unzipped. Checked on the
# host too, so the no-Docker build cannot pass silently over the limit.
LAYER_BYTES=$(find "$LAYER_DIR" -type f -exec cat {} + | wc -c | tr -d ' ')
if [ "$LAYER_BYTES" -ge $((250 * 1024 * 1024)) ]; then
    echo "Crawler layer is $LAYER_BYTES bytes unzipped; Lambda's limit is 250 MB" >&2
    exit 1
fi
echo "Crawler layer unzipped size: $((LAYER_BYTES / 1024 / 1024)) MB (limit 250 MB)"

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
        -c "import boto3, botocore, inspect, os; from bedrock_agentcore.tools.browser_client import BrowserClient; from playwright.sync_api import sync_playwright; size = sum(os.path.getsize(os.path.join(root, name)) for root, _, names in os.walk('/opt/python') for name in names); assert size < 250 * 1024 * 1024, f'crawler layer is {size} bytes'; assert boto3.__version__ == '1.43.123'; assert botocore.__version__ == '1.43.123'; client = BrowserClient(region='us-west-2'); required = {'identifier', 'name', 'session_timeout_seconds'}; assert required <= set(inspect.signature(client.start).parameters); assert callable(client.generate_ws_headers); assert callable(client.stop); assert sync_playwright"
else
    echo "Skipping Lambda-runtime import smoke test because Docker is unavailable"
fi

echo ""
echo "Layer contents:"
find "$LAYER_DIR" -mindepth 1 -maxdepth 1 | sort | head -20
echo ""
echo "Shared modules:"
ls -la "$LAYER_DIR/shared/"
echo ""
echo "Layer size:"
du -sh "$LAYER_DIR/"
echo ""
echo "Crawler Lambda Layer built successfully"
