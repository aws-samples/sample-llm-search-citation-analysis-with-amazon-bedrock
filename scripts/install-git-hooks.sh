#!/usr/bin/env bash
# Link the versioned hooks in .githooks/ into this clone's .git/hooks/.
#
# Run by `npm run hooks:install`, and by `npm install` through the root
# `prepare` script. It never changes git config: a global core.hooksPath (Code
# Defender sets one in /etc/gitconfig) keeps working, because Code Defender
# runs the repository's own .git/hooks after its checks. An existing hook that
# is not ours is left alone, with a warning.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Not a git checkout (e.g. a source archive, or npm install during a build): nothing to do.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# --git-common-dir: the main .git directory, also from inside a worktree.
hooks_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)/hooks"
mkdir -p "$hooks_dir"

for source in .githooks/*; do
  name="$(basename "$source")"
  target="$hooks_dir/$name"
  chmod +x "$source"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$repo_root/$source" ]; then
    continue
  fi
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "install-git-hooks: $target exists and is not ours; left unchanged. Remove it and re-run to install $source." >&2
    continue
  fi
  ln -sf "$repo_root/$source" "$target"
  echo "install-git-hooks: installed $name -> $source"
done
