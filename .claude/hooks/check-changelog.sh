#!/usr/bin/env bash
# Blocks gh pr merge when CHANGELOG.md has not been updated on the current branch.
cmd=$(jq -r '.tool_input.command // ""')
echo "$cmd" | grep -qE '(^| )gh pr merge' || exit 0
if git diff main...HEAD -- CHANGELOG.md | grep -q '^+[^+]'; then
  exit 0
fi
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"CHANGELOG.md has not been updated on this branch. Add an entry before merging."}}\n'
exit 2
