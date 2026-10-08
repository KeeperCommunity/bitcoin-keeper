#!/usr/bin/env bash
# Build diagnostic APK/AAB with placeholder configuration in a Linux container.
# This script does not compare a published binary or report reproducibility.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: reproducibility/android-diagnostic.sh --source-commit SHA --output-dir DIR

Builds a diagnostic Android APK and AAB with dummy service values and the
checked-in debug signing key. DIR must be outside the source checkout and empty.
Requires Docker and a clean, disposable source checkout with no node_modules.
EOF
}

source_commit=''
output_dir=''
while (($#)); do
  case "$1" in
    --source-commit)
      (($# >= 2)) || { usage >&2; exit 2; }
      source_commit=$2
      shift 2
      ;;
    --output-dir)
      (($# >= 2)) || { usage >&2; exit 2; }
      output_dir=$2
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

[[ $source_commit =~ ^[0-9a-f]{40}$ && -n $output_dir ]] || { usage >&2; exit 2; }
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ $(git -C "$repo" rev-parse HEAD) == "$source_commit" ]] || {
  echo 'Checkout HEAD differs from the requested source commit.' >&2
  exit 1
}
[[ -z $(git -C "$repo" status --porcelain=v1 --untracked-files=normal) ]] || {
  echo 'Source checkout must be clean.' >&2
  exit 1
}
[[ ! -e "$repo/node_modules" && ! -L "$repo/node_modules" ]] || {
  echo 'Use a disposable checkout without node_modules.' >&2
  exit 1
}

mkdir -p "$output_dir"
output_dir=$(cd "$output_dir" && pwd -P)
case "$output_dir/" in
  "$repo/"*) echo 'Output directory must be outside the source checkout.' >&2; exit 1 ;;
esac
[[ -z $(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit) ]] || {
  echo 'Output directory must be empty.' >&2
  exit 1
}

image="keeper-android-diagnostic:${source_commit:0:12}-$$"
docker build --platform linux/amd64 \
  -f "$repo/reproducibility/Dockerfile.android-diagnostic" \
  -t "$image" "$repo/reproducibility"

# A Git worktree has a .git file pointing into its parent repository. Expose
# that metadata read-only at the same path so the input checker can verify HEAD.
git_common_dir=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
git_mount=()
case "$git_common_dir/" in
  "$repo/"*) ;;
  *) git_mount=(--mount "type=bind,source=$git_common_dir,target=$git_common_dir,readonly") ;;
esac

echo "Diagnostic source commit: $source_commit"
echo "Diagnostic toolchain image: $(docker image inspect --format '{{.Id}}' "$image")"
docker run --rm --platform linux/amd64 \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$repo,target=/workspace/keeper" \
  --mount "type=bind,source=$output_dir,target=/output" \
  "${git_mount[@]}" \
  --env "KEEPER_SOURCE_COMMIT=$source_commit" \
  --env 'HOME=/tmp/keeper-home' \
  --env 'NPM_CONFIG_CACHE=/tmp/keeper-npm' \
  --env 'XDG_CACHE_HOME=/tmp/keeper-xdg-cache' \
  --env 'GIT_OPTIONAL_LOCKS=0' \
  --env 'GIT_CONFIG_COUNT=1' \
  --env 'GIT_CONFIG_KEY_0=safe.directory' \
  --env 'GIT_CONFIG_VALUE_0=/workspace/keeper' \
  "$image" bash /workspace/keeper/reproducibility/android-diagnostic-in-container.sh
