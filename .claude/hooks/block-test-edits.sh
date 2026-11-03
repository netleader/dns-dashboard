#!/usr/bin/env bash
# PreToolUse hook for the implementer (Edit|Write|NotebookEdit|Bash).
# Denies changes to test files, test config and .claude/:
#   dns-dashboard/app/server/test/**, **/*.test.ts, **/*.test.tsx, **/__tests__/**, .claude/**
# Bash commands are checked heuristically (redirects, tee, sed/perl -i, rm, mv,
# cp, touch, ..., git work-tree commands). The reviewer's diff check since
# tests_commit is the backstop. Written for bash 3.2 (macOS /bin/bash).
set -f -o pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "block-test-edits.sh: jq is not installed" >&2
  exit 2
fi

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

input=$(cat)
tool=$(jq -r '.tool_name // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
root=${CLAUDE_PROJECT_DIR:-$cwd}
root=${root%/}
cwd=${cwd:-$root}
reason='The implementer may not change tests, test config or .claude/. If a test looks wrong, answer STATUS: TEST_DISPUTE.'

# Collapse ".", ".." and empty segments of an absolute path.
normalize() {
  local IFS=/ part out=
  for part in $1; do
    case $part in
      ''|.) ;;
      ..) out=${out%/*} ;;
      *) out="$out/$part" ;;
    esac
  done
  printf '%s' "${out:-/}"
}

# Repo-relative form of a path; relative paths resolve against the tool's cwd.
rel() {
  local p=$1
  p=${p#[\"\']}; p=${p%[\"\']}
  case $p in
    /*) ;;
    "~"*) p="$HOME${p#\~}" ;;
    *) p="$cwd/$p" ;;
  esac
  p=$(normalize "$p")
  if [ "$p" = "$root" ]; then printf '.'; else printf '%s' "${p#"$root"/}"; fi
}

is_protected() {
  case $1 in
    dns-dashboard/app/server/test|dns-dashboard/app/server/test/*) return 0 ;;
    *.test.ts|*.test.tsx|__tests__|__tests__/*|*/__tests__|*/__tests__/*) return 0 ;;
    .claude|.claude/*) return 0 ;;
  esac
  return 1
}

# True if the (repo-relative) path is protected or is a directory containing protected files.
touches_protected() {
  local r=$1 abs
  is_protected "$r" && return 0
  case $r in
    .|dns-dashboard|dns-dashboard/app|dns-dashboard/app/server) return 0 ;;
  esac
  case $r in /*) abs=$r ;; .) abs=$root ;; *) abs="$root/$r" ;; esac
  if [ -d "$abs" ]; then
    [ -n "$(find "$abs" -name node_modules -prune -o \( -name '*.test.ts' -o -name '*.test.tsx' \
      -o -name __tests__ -o -name .claude \) -print 2>/dev/null | head -n 1)" ] && return 0
  fi
  case $r in *'*'*|*'?'*) case $r in *test*|*.claude*) return 0 ;; esac ;; esac
  return 1
}

case $tool in
  Edit|Write|MultiEdit|NotebookEdit)
    p=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
    [ -n "$p" ] && is_protected "$(rel "$p")" && deny "$reason ($p)"
    exit 0
    ;;
  Bash) ;;
  *) exit 0 ;;
esac

cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
[ -n "$cmd" ] || exit 0

# A cwd inside a protected directory makes every write suspicious.
cwd_rel=$(rel "$cwd")
writes='(^|[^0-9&<])>|(^|[[:space:];|&(])(tee|rm|rmdir|mv|cp|touch|truncate|ln|install|rsync|dd|patch|unlink)[[:space:]]|sed[[:space:]].*-i|perl[[:space:]].*-[a-z]*i'
if is_protected "$cwd_rel" && grep -qE "$writes" <<<"$cmd"; then
  deny "$reason (working directory $cwd_rel)"
fi

# Redirect targets: > file, >> file, &> file (skips >&2, 2>&1, /dev/null).
while IFS= read -r t; do
  t=$(sed -E 's/^[0-9&]?>>?\|?[[:space:]]*//' <<<"$t")
  [ -z "$t" ] || [ "$t" = /dev/null ] && continue
  touches_protected "$(rel "$t")" && deny "$reason (redirect to $t)"
done < <(grep -oE '[0-9&]?>>?\|?[[:space:]]*[^[:space:]&|;<>()]+' <<<"$cmd")

# Writes from scripting one-liners (node -e, python -c, ...).
if grep -qE '(writeFile|appendFile|unlink|rmSync|rmdir|renameSync|copyFile|cpSync|truncate|open\(.*["'\''][wa]|shutil|os\.remove)' <<<"$cmd" &&
   grep -qE '(server/test|\.test\.tsx?|__tests__|\.claude)' <<<"$cmd"; then
  deny "$reason (script writes to a protected path)"
fi

# Per simple command: split on ; && || | and newlines.
segments=$(sed -E 's/(&&|\|\||;|\|)/\
/g' <<<"$cmd")
while IFS= read -r seg; do
  set -- $seg
  # skip env assignments and wrappers
  while [ $# -gt 0 ]; do
    case $1 in
      *=*|sudo|command|exec|nohup|time|xargs|-*) shift ;;
      *) break ;;
    esac
  done
  [ $# -gt 0 ] || continue
  prog=${1##*/}; shift
  case $prog in
    git)
      while [ $# -gt 0 ]; do case $1 in -C|-c) shift 2 ;; -*) shift ;; *) break ;; esac; done
      case ${1:-} in
        checkout|restore|stash|rm|mv|reset|clean|apply|switch|am|cherry-pick|revert|merge|rebase|pull)
          deny "$reason git $1 can change test files; git operations are reserved for the orchestrator." ;;
      esac
      ;;
    rm|rmdir|mv|touch|truncate|unlink|ln|install|rsync|patch|chmod|tee)
      for a in "$@"; do
        case $a in -*) continue ;; esac
        touches_protected "$(rel "$a")" && deny "$reason ($prog $a)"
      done
      ;;
    cp)
      dest=
      for a in "$@"; do case $a in -*) ;; *) dest=$a ;; esac; done
      if [ -n "$dest" ]; then
        touches_protected "$(rel "$dest")" && deny "$reason (cp to $dest)"
        for a in "$@"; do
          case $a in -*) continue ;; esac
          [ "$a" = "$dest" ] && continue
          is_protected "$(rel "$dest/${a##*/}")" && deny "$reason (cp to $dest/${a##*/})"
        done
      fi
      ;;
    sed|perl)
      inplace=
      for a in "$@"; do case $a in -i*|-[a-zA-Z]*i*|--in-place*) inplace=1 ;; esac; done
      if [ -n "$inplace" ]; then
        for a in "$@"; do
          case $a in -*) continue ;; esac
          is_protected "$(rel "$a")" && deny "$reason ($prog -i $a)"
        done
      fi
      ;;
    dd)
      for a in "$@"; do
        case $a in of=*) touches_protected "$(rel "${a#of=}")" && deny "$reason (dd $a)" ;; esac
      done
      ;;
    find)
      if grep -qE -- '-delete|-exec|-execdir|-ok' <<<"$seg"; then
        for a in "$@"; do
          case $a in -*) break ;; esac
          touches_protected "$(rel "$a")" && deny "$reason (find with -delete/-exec on $a)"
        done
      fi
      ;;
  esac
done <<<"$segments"

exit 0
