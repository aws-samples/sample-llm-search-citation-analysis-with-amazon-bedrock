#!/usr/bin/env bash
# Install the pinned lint binaries the CI lint lane runs (gitleaks for scripts/gitleaks-tree.sh, actionlint and
# zizmor for scripts/actions-lint.sh) into ~/.local/bin, on Linux x86_64.
#
# Each tool comes from its GitHub release, checked against the SHA-256 digest committed below (not a checksum
# file fetched from the same release, which whoever could replace the asset could replace too). GitHub's release
# downloads sometimes answer 504 for a long while, so when the release cannot be fetched the tool is installed
# from a second registry with its own integrity check instead of failing the lane:
#   - gitleaks, actionlint: `go install <module>@<version>` through proxy.golang.org; the Go command verifies the
#     module against the public checksum database (sum.golang.org), so a changed module is refused.
#   - zizmor: its PyPI wheel, installed with `pip --require-hashes` against the digest committed below.
# A digest mismatch is never retried or skipped: it fails the step.
#
# Bump: change a version and its digests together, and ACTIONLINT_VERSION / ZIZMOR_VERSION in
# scripts/actions-lint.sh.
#
# Usage: scripts/install-ci-tools.sh gitleaks | actions-lint
set -euo pipefail

GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
GITLEAKS_MODULE=github.com/zricethezav/gitleaks/v8
ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
ACTIONLINT_MODULE=github.com/rhysd/actionlint/cmd/actionlint
ZIZMOR_VERSION=1.31.1
ZIZMOR_SHA256=d185f726bdaf92df78273217dfdd24ebcd6b0ef48cf3ce776ff5762b6e138c99
ZIZMOR_WHEEL_SHA256=58e878eb2dbd2c6183c105e1ac28c14f7dd1eca44a783f1fe2a69647d012c410

BIN="$HOME/.local/bin"
mkdir -p "$BIN"

# Download a release asset and check it against its committed digest. Returns 1 only when the download failed
# (the caller then falls back); a digest mismatch exits the whole script. The check is explicit because
# callers use this function as an `if` condition, where `set -e` does not apply.
release() {
  local url="$1" digest="$2" file="/tmp/${1##*/}"
  if ! curl -sSfL --retry 3 --retry-all-errors --retry-delay 10 -o "$file" "$url"; then
    printf 'install-ci-tools: release download failed: %s\n' "$url" >&2
    return 1
  fi
  if ! echo "${digest}  ${file}" | sha256sum --check --strict - >&2; then
    printf 'install-ci-tools: %s does not match its committed digest; refusing it and stopping\n' "$url" >&2
    exit 1
  fi
}

# The Go module proxy and checksum database verify the module; GOTOOLCHAIN=auto fetches the Go version the
# module asks for the same way.
go_install() {
  local module="$1" version="$2" ldflags="${3:-}"
  printf 'install-ci-tools: installing %s@v%s from proxy.golang.org (checked against sum.golang.org)\n' "$module" "$version"
  CGO_ENABLED=0 GOBIN="$BIN" GOTOOLCHAIN=auto GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org \
    go install -ldflags "$ldflags" "${module}@v${version}"
}

install_gitleaks() {
  local tarball="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
  if release "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${tarball}" "$GITLEAKS_SHA256"; then
    tar -xzf "/tmp/${tarball}" -C "$BIN" gitleaks
  else
    # The release build stamps its version the same way (gitleaks' Makefile).
    go_install "$GITLEAKS_MODULE" "$GITLEAKS_VERSION" "-X=${GITLEAKS_MODULE}/version.Version=v${GITLEAKS_VERSION}"
  fi
}

install_actionlint() {
  local tarball="actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
  if release "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${tarball}" "$ACTIONLINT_SHA256"; then
    tar -xzf "/tmp/${tarball}" -C "$BIN" actionlint
  else
    go_install "$ACTIONLINT_MODULE" "$ACTIONLINT_VERSION"
  fi
}

install_zizmor() {
  local tarball="zizmor-x86_64-unknown-linux-gnu.tar.gz"
  if release "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/${tarball}" "$ZIZMOR_SHA256"; then
    tar -xzf "/tmp/${tarball}" -C "$BIN" zizmor
    return
  fi
  printf 'install-ci-tools: installing zizmor %s from PyPI (hash-pinned wheel)\n' "$ZIZMOR_VERSION"
  local requirements=/tmp/zizmor-requirements.txt
  printf 'zizmor==%s --hash=sha256:%s\n' "$ZIZMOR_VERSION" "$ZIZMOR_WHEEL_SHA256" > "$requirements"
  python3 -m venv /tmp/zizmor-venv
  /tmp/zizmor-venv/bin/pip install --quiet --require-hashes --only-binary=:all: -r "$requirements"
  ln -sf /tmp/zizmor-venv/bin/zizmor "$BIN/zizmor"
}

case "${1:-}" in
  gitleaks) install_gitleaks ;;
  actions-lint) install_actionlint; install_zizmor ;;
  *) printf 'usage: %s gitleaks | actions-lint\n' "$0" >&2; exit 2 ;;
esac

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$BIN" >> "$GITHUB_PATH"
fi
