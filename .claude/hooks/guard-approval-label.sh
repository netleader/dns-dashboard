#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash, all sessions and agents). The "approved"
# label is the user's approval gate, so Claude may not add, remove or redefine
# it. Reading labels (gh issue view/list) stays allowed. This is a guard
# against mistakes, not a sandbox: it inspects the command text only.
set -o pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "guard-approval-label.sh: jq is not installed" >&2
  exit 2
fi

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0
reason='Only the user may set or remove the "approved" label (ticket approval gate).'

has() { grep -qiE -- "$1" <<<"$cmd"; }

# gh issue/pr edit|create with a label flag in a command that mentions "approved"
if has 'gh[[:space:]]+(issue|pr)[[:space:]]+(edit|create)' &&
   has '(--add-label|--remove-label|--label|[[:space:]]-l)([[:space:]=]|$)' &&
   has 'approved'; then
  deny "$reason"
fi

# gh label create/edit/delete/clone touching "approved"
if has 'gh[[:space:]]+label' && has 'approved'; then
  deny "$reason"
fi

# gh api writes that involve labels (REST label endpoints or GraphQL label mutations)
if has 'gh[[:space:]]+api' && has 'label'; then
  if has '(-X|--method)[[:space:]=]*(POST|PUT|PATCH|DELETE)' ||
     has '(^|[[:space:]])(-f|-F|--field|--raw-field|--input)([[:space:]=]|$)'; then
    deny "$reason Use 'gh issue view N --json labels' to read labels."
  fi
fi

# direct HTTP calls to the GitHub API involving labels
if has '(curl|wget|http|https|xh)[[:space:]]' && has 'api\.github\.com' && has 'label'; then
  deny "$reason"
fi

exit 0
