#!/usr/bin/env bash
# PreToolUse hook for planner.agent.md
# Restricts file edits to the docs/plans/ directory only.
#
# Receives tool call context on stdin as JSON.
# Exits non-zero to block the tool call; zero to allow.
# Passes through silently on Windows (no bash) or when tool context is unreadable.

set -o errexit
set -o nounset
set -o pipefail

# Read tool call context from stdin (may be empty if not provided)
input=$(cat 2>/dev/null || true)

# If no input, allow (fail open — don't break non-hook environments)
if [ -z "$input" ]; then
  exit 0
fi

# Only intercept file-editing tools
tool_name=$(echo "$input" | grep -o '"tool_name"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"tool_name"\s*:\s*"//;s/"//')
case "$tool_name" in
  create_file|replace_string_in_file|multi_replace_string_in_file|edit_file|write_file)
    ;;
  *)
    exit 0
    ;;
esac

# Extract the file path — try filePath first, then path
file_path=$(echo "$input" | grep -o '"filePath"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"filePath"\s*:\s*"//;s/"//')
if [ -z "$file_path" ]; then
  file_path=$(echo "$input" | grep -o '"path"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"path"\s*:\s*"//;s/"//')
fi

# If we still can't determine the path, allow (fail open)
if [ -z "$file_path" ]; then
  exit 0
fi

# Normalise to forward slashes
file_path=$(echo "$file_path" | tr '\\' '/')

# Allow only paths under docs/plans/
case "$file_path" in
  docs/plans/*|*/docs/plans/*)
    exit 0
    ;;
  *)
    echo "ERROR: Planner may only write to docs/plans/." >&2
    echo "Attempted path: $file_path" >&2
    echo "Use @implementer for changes to source files." >&2
    exit 1
    ;;
esac
