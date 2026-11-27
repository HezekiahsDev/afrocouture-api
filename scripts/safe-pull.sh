#!/usr/bin/env bash
# safe-pull: use instead of `git pull`. Fetches, checks the incoming commits with git-guard
# (without running any of them), and only then fast-forwards. Never merges or rebases.
#   scripts/safe-pull.sh            # current branch from origin
#   scripts/safe-pull.sh main       # a specific branch
set -euo pipefail
branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
here="$(cd "$(dirname "$0")" && pwd)"

git fetch origin "$branch"
# Run the guard as committed in HEAD (the version you already trust), not the incoming one.
guard="$(mktemp)"
trap 'rm -f "$guard"' EXIT
git show "HEAD:scripts/git-guard.sh" >"$guard" 2>/dev/null || cp "$here/git-guard.sh" "$guard"
bash "$guard" --base HEAD --target "origin/$branch"

if [[ "$(git rev-parse --abbrev-ref HEAD)" == "$branch" ]]; then
  git merge --ff-only "origin/$branch"
else
  git fetch . "origin/$branch:$branch"
fi
