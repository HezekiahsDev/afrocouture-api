#!/usr/bin/env bash
# git-guard: inspect commits BEFORE they are checked out, built, installed or opened.
#
# It only reads git objects (never runs code from the commits it inspects) and looks for
# the tricks used against this project in Oct–Nov 2026:
#   - history rewritten by force-push (same message and date, different content)
#   - package.json scripts changed to run a file first ("node init && …") or new install hooks
#   - code hidden after hundreds of spaces/tabs, obfuscated or eval'd code
#   - "fonts"/images that are really JavaScript, VS Code tasks that run on folder open
#   - committed .env files and .gitignore no longer ignoring them
#
# Usage:
#   scripts/git-guard.sh --target origin/main            # check incoming commits against HEAD
#   scripts/git-guard.sh --base origin/main --target HEAD # check outgoing commits
#   scripts/git-guard.sh --base origin/main --target WORKTREE  # also uncommitted + untracked files
#
# Exit codes: 0 = nothing blocking (warnings may be printed), 2 = blocked, 1 = usage/git error.
# Env: GUARD_ALLOW_REWRITE=1 turns a rewritten history into a warning (after you have checked it);
#      GUARD_STRICT=1 also blocks on warnings.
set -uo pipefail

BASE="HEAD"
TARGET=""
ALLOW_REWRITE="${GUARD_ALLOW_REWRITE:-0}"
STRICT="${GUARD_STRICT:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --allow-rewrite) ALLOW_REWRITE=1; shift ;;
    --strict) STRICT=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "git-guard: unknown argument $1" >&2; exit 1 ;;
  esac
done
[[ -n "$TARGET" ]] || { echo "git-guard: --target is required" >&2; exit 1; }

BLOCKS=()
WARNS=()
block() { BLOCKS+=("$1"); }
warn() { WARNS+=("$1"); }

base_sha="$(git rev-parse --verify -q "$BASE^{commit}")" || { echo "git-guard: unknown base $BASE" >&2; exit 1; }
worktree=0
if [[ "$TARGET" == "WORKTREE" ]]; then
  worktree=1
  target_sha="$(git rev-parse HEAD)"
else
  target_sha="$(git rev-parse --verify -q "$TARGET^{commit}")" || { echo "git-guard: unknown target $TARGET" >&2; exit 1; }
fi

# ── 1. History: the target must contain the base (no force-push rewrite) ──
range_base="$base_sha"
if ! git merge-base --is-ancestor "$base_sha" "$target_sha"; then
  mb="$(git merge-base "$base_sha" "$target_sha" || true)"
  [[ -n "$mb" ]] || { block "History has nothing in common with $BASE"; mb="$base_sha"; }
  range_base="$mb"
  dropped="$(git rev-list --count "$mb..$base_sha")"
  msg="History rewritten: $TARGET drops $dropped commit(s) that $BASE has (force-push)."
  # The attacker re-created commits with the same message and author date: name those twins.
  while IFS='|' read -r sha when subject; do
    twin="$(git log --format='%h|%ad|%s' --date=raw "$mb..$target_sha" | awk -F'|' -v w="$when" -v s="$subject" '$2==w && $3==s {print $1; exit}')"
    [[ -n "$twin" ]] && msg+=$'\n'"    $twin re-creates $sha \"$subject\" with different content: $(git diff --shortstat "$sha" "$twin")"
  done < <(git log --format='%h|%ad|%s' --date=raw "$mb..$base_sha")
  if [[ "$ALLOW_REWRITE" == "1" ]]; then warn "$msg"; else block "$msg"; fi
fi

# ── 2. Commit metadata ──
if [[ "$range_base" != "$target_sha" ]]; then
  while IFS='|' read -r sha atz ctz at ct subject; do
    if [[ "$atz" != "$ctz" ]] && (( ct - at > 3600 )); then
      warn "Commit $sha was re-committed $(( (ct - at) / 3600 ))h after it was written, from another timezone ($atz → $ctz): \"$subject\""
    fi
  done < <(git log --format='%h|%ai|%ci|%at|%ct|%s' "$range_base..$target_sha" | awk -F'|' '{ split($2,a," "); split($3,c," "); print $1"|"a[3]"|"c[3]"|"$4"|"$5"|"$6 }')
fi

# ── 3. File contents ──
# Read a file's new content and its added lines, from the target commit or the working tree.
content() { if (( worktree )); then cat -- "$1" 2>/dev/null; else git show "$target_sha:$1" 2>/dev/null; fi; }
added_lines() {
  if (( worktree )) && ! git ls-files --error-unmatch -- "$1" >/dev/null 2>&1; then
    sed 's/^/+/' -- "$1" 2>/dev/null
  elif (( worktree )); then
    git diff --ignore-cr-at-eol "$range_base" -- "$1" | grep -a '^+' | grep -av '^+++'
  else
    git diff --ignore-cr-at-eol "$range_base" "$target_sha" -- "$1" | grep -a '^+' | grep -av '^+++'
  fi
}
removed_lines() {
  if (( worktree )); then git diff --ignore-cr-at-eol "$range_base" -- "$1"; else git diff --ignore-cr-at-eol "$range_base" "$target_sha" -- "$1"; fi | grep -a '^-' | grep -av '^---'
}

changed_files() {
  if (( worktree )); then
    git diff --name-status --no-renames "$range_base"
    git ls-files --others --exclude-standard | sed 's/^/A\t/'
  else
    git diff --name-status --no-renames "$range_base" "$target_sha"
  fi
}

BINARY_EXT='\.(ttf|otf|woff2?|eot|png|jpe?g|gif|ico|webp|avif|bmp|pdf|mp[34]|mov|zip|gz)$'
LOCKFILE='(^|/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$'
# Lines that are effectively always malicious in this codebase.
HARD='(^|[^.A-Za-z0-9_$])eval\(|new Function\(|_0x[0-9a-f]{4,}|global(This)?\[['"'"'"][^]]*\][[:space:]]*=|\.split\(["'"'"']{2}\)\.reverse\(\)\.join|atob\(process\.env|from\(process\.env\.[A-Z_]+, *["'"'"']base64|(curl|wget)[^|;]*\|[[:space:]]*(ba)?sh|Invoke-Web[R]equest|runOn["'"'"']?[[:space:]]*:[[:space:]]*["'"'"']folderOpen'

while IFS=$'\t' read -r status path; do
  [[ -z "${path:-}" || "$status" == D* ]] && continue
  base="${path##*/}"

  # Secrets and ignore rules
  if [[ "$base" =~ ^\.env($|\.) && ! "$base" =~ \.example$ ]]; then
    block "$path: an environment file is being committed"
  fi
  if [[ "$base" == ".gitignore" ]] && removed_lines "$path" | grep -aqE '^-[[:space:]]*\.env'; then
    block "$path: stops ignoring .env files"
  fi

  # Files that look like media but contain JavaScript
  if [[ "$path" =~ $BINARY_EXT ]]; then
    sample="$(content "$path" | head -c 65536 | LC_ALL=C tr -d '\0' | LC_ALL=C tr -c '\11\12\15\40-\176' '\1')"
    total=${#sample}
    nontext="$(LC_ALL=C tr -cd '\1' <<<"$sample" | wc -c)"
    # Real fonts/images are mostly non-text bytes; a disguised script is almost all text.
    if (( total > 0 && nontext * 10 < total )) && grep -aqE 'require\(|function[[:space:]]*\(|=>|global\[|eval\(|module\.exports' <<<"$sample"; then
      block "$path: named like a font/image but contains JavaScript"
    fi
    continue
  fi

  # Editor tasks that run code when the folder is opened
  if [[ "$path" == .vscode/* || "$path" == */.vscode/* ]]; then
    if content "$path" | grep -aqiE 'folderOpen'; then block "$path: VS Code task runs automatically when the folder is opened"
    else warn "$path: editor settings changed (review)"; fi
    continue
  fi

  if [[ "$path" =~ $LOCKFILE ]]; then
    if added_lines "$path" | grep -aE '(tarball|resolved)[": ]+[^ ]*https?://' | grep -avqE 'registry\.npmjs\.org|registry\.yarnpkg\.com'; then
      warn "$path: a dependency now downloads from outside the npm registry"
    fi
    continue
  fi

  # package.json: install hooks and scripts that run a file first
  if [[ "$base" == "package.json" ]]; then
    lines="$(added_lines "$path")"
    if grep -aqE '^\+[[:space:]]*"(pre|post)?install"[[:space:]]*:|^\+[[:space:]]*"(prepare|prepublish|prepack|postpack)"[[:space:]]*:' <<<"$lines"; then
      block "$path: adds an install/prepare hook, which runs on 'pnpm install'"
    fi
    while IFS= read -r line; do
      block "$path: script now runs a file first: ${line#+}"
    done < <(grep -aoE '"[^"]+"[[:space:]]*:[[:space:]]*"[^"]*node [^"&]+&&[^"]*"' <<<"$(grep -a '^+' <<<"$lines")" | grep -avE 'node (dist|build|\.next)/' | head -5)
    while IFS= read -r line; do
      warn "$path: dependency added or changed: $(sed -E 's/^\+[[:space:]]*//; s/,$//' <<<"$line")"
    done < <(grep -aE '^\+[[:space:]]*"(@[a-z0-9._-]+/)?[a-z0-9._-]+"[[:space:]]*:[[:space:]]*"(npm:|github:|git\+|https?:|file:|[~^]?[0-9])' <<<"$lines" | grep -avE '"(version|packageManager)"[[:space:]]*:' | head -15)
  fi

  # Scripts that run on servers or CI deserve a human look
  if [[ "$path" == *.sh || "$path" == .github/* || "$path" == scripts/* || "$base" == "Dockerfile" || "$base" == docker-compose*.yml ]]; then
    warn "$path: changes a script that runs on servers or CI (review before deploying)"
  fi

  # Generic code checks on added lines (SVGs and maps legitimately have long lines)
  [[ "$path" =~ \.(svg|map|min\.js|min\.css|snap)$ ]] && continue
  lines="$(added_lines "$path")"
  [[ -z "$lines" ]] && continue
  # Code pushed far off-screen. In code/config files any such line counts; elsewhere (Markdown
  # tables, ASCII diagrams) only when what follows looks like code.
  hidden="$(grep -aoE '[[:space:]]{120,}[^[:space:]].*' <<<"$lines" | head -3)"
  if [[ -n "$hidden" ]]; then
    if [[ "$path" =~ \.(c?js|mjs|jsx?|tsx?|json|ya?ml|sh|cjs)$ || "$path" != *.* ]] \
       || grep -aqE '(require|eval|function|import)[[:space:]]*\(|=>|global\[|var [a-zA-Z_$]+[[:space:]]*=|;[^ ]*;' <<<"$hidden"; then
      block "$path: code hidden after a long run of spaces/tabs"
    fi
  fi
  long="$(awk 'length($0) > 3000 { print length($0); exit }' <<<"$lines")"
  [[ -n "$long" ]] && block "$path: a single line of $long characters (minified or obfuscated code)"
  hard="$(grep -aoE "$HARD" <<<"$lines" | head -1)"
  [[ -n "$hard" ]] && block "$path: suspicious code: ${hard:0:60}"
  if grep -aqE '[A-Za-z0-9+/]{400,}={0,2}' <<<"$lines"; then warn "$path: contains a long base64 blob"; fi
  if grep -aqE "require\(['\"](node:)?child_process|from ['\"](node:)?child_process" <<<"$lines"; then warn "$path: starts other programs (child_process)"; fi
  # New executable files at the repository root (the attacks added ./init and ./api.js)
  if [[ "$path" != */* && "$status" == A* && ( "$path" =~ \.(c?js|mjs)$ || "$path" != *.* ) ]]; then
    warn "$path: new file at the repository root"
  fi
done < <(changed_files)

# ── Report ──
label="$BASE → $TARGET"
if (( ${#BLOCKS[@]} == 0 && ${#WARNS[@]} == 0 )); then
  echo "git-guard: OK ($label, $(git rev-list --count "$range_base..$target_sha") commit(s) checked)"
  exit 0
fi
echo "git-guard report ($label)"
for b in "${BLOCKS[@]}"; do echo "  BLOCK  $b"; done
for w in "${WARNS[@]}"; do echo "  warn   $w"; done

if (( ${#BLOCKS[@]} > 0 )) || [[ "$STRICT" == "1" && ${#WARNS[@]} -gt 0 ]]; then
  echo
  echo "git-guard: STOPPED. Nothing from $TARGET was checked out, installed or run."
  if [[ "$TARGET" == origin/* && $worktree -eq 0 ]]; then
    branch="${TARGET#origin/}"
    echo "If $BASE ($(git rev-parse --short "$base_sha")) is your known-good version and the remote was tampered with,"
    echo "first rotate your GitHub credentials, then restore the remote with:"
    echo "  git push origin --force-with-lease=refs/heads/$branch:$target_sha $base_sha:refs/heads/$branch"
  fi
  exit 2
fi
echo "git-guard: no blocking findings; review the warnings above."
exit 0
