#!/usr/bin/env bash
# PreToolUse hook (matcher: Agent). Delegations to test-writer and implementer
# must name "TICKET: #N" for an open GitHub issue that carries the label
# "approved" and whose body was not edited after the label was added.
# Fails closed: if GitHub cannot be reached, the delegation is denied.
set -o pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "require-approval.sh: jq is not installed; cannot verify ticket approval" >&2
  exit 2
fi

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

input=$(cat)
agent=$(jq -r '.tool_input.subagent_type // empty' <<<"$input")
case $agent in
  test-writer|implementer) ;;
  *) exit 0 ;;
esac

prompt=$(jq -r '.tool_input.prompt // empty' <<<"$input")
ids=$(grep -oE 'TICKET:[[:space:]]*#[0-9]+' <<<"$prompt" | grep -oE '[0-9]+' | sort -u)
[ -n "$ids" ] || deny "Delegation to $agent must contain 'TICKET: #N' (GitHub issue number)."
[ "$(wc -l <<<"$ids" | tr -d ' ')" = 1 ] || deny "Delegation to $agent names more than one ticket: $(tr '\n' ' ' <<<"$ids")"
num=$ids

cd "${CLAUDE_PROJECT_DIR:-.}" || deny "Cannot change to the project directory."

query='query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      state
      lastEditedAt
      labels(first: 100) { nodes { name } }
      timelineItems(itemTypes: [LABELED_EVENT], last: 100) {
        nodes { ... on LabeledEvent { createdAt label { name } } }
      }
    }
  }
}'
if ! res=$(gh api graphql -f query="$query" -F owner='{owner}' -F name='{repo}' -F n="$num" 2>&1); then
  grep -q '"NOT_FOUND"' <<<"$res" && deny "Issue #$num does not exist."
  deny "Could not verify approval of #$num on GitHub: $(head -c 300 <<<"$res")"
fi

verdict=$(jq -r '
  .data.repository.issue as $i
  | if $i == null then "Issue #\($n) does not exist."
    elif $i.state != "OPEN" then "Issue #\($n) is not open."
    elif ([$i.labels.nodes[].name] | index("approved")) == null then
      "Ticket #\($n) is not approved. The user must add the label \"approved\"."
    else
      ([$i.timelineItems.nodes[] | select(.label.name == "approved") | .createdAt] | max) as $at
      | if $at == null then "Cannot determine when #\($n) was approved."
        elif $i.lastEditedAt != null and $i.lastEditedAt > $at then
          "Ticket #\($n) was edited after approval. The user must remove and re-add the label \"approved\"."
        else "ok" end
    end' --arg n "$num" <<<"$res" 2>/dev/null) || deny "Unexpected GitHub response for #$num."

[ "$verdict" = ok ] || deny "$verdict"
exit 0
