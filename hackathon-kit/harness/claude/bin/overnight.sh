#!/usr/bin/env bash
# Запускает автономную ночную работу Claude Code по docs/OVERNIGHT.md в отдельном worktree и ветке night/*.
#   bash .claude/bin/overnight.sh [--mode auto|bypassPermissions] [--model <id>] [--budget <usd>]
# main не трогается; guard-хук из .claude/settings.json блокирует опасные git-команды и утечку ключей.
set -euo pipefail

MODE="auto"
MODEL=""
BUDGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --budget) BUDGET="$2"; shift 2 ;;
    *) sed -n '2,4p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 1 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
command -v claude >/dev/null || { echo "Не найден claude CLI" >&2; exit 1; }
[[ -f docs/OVERNIGHT.md ]] || { echo "Нет docs/OVERNIGHT.md — сначала /overnight" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Есть незакоммиченные изменения — закоммить их до запуска" >&2; exit 1; }

STAMP="$(date +%Y%m%d-%H%M)"
BRANCH="night/$STAMP"
TREE="$(dirname "$ROOT")/$(basename "$ROOT")-night-$STAMP"
LOG="$TREE.log"

git worktree add -q -b "$BRANCH" "$TREE"
# .env* не в git, поэтому в worktree их нет: копируем, чтобы проект запускался так же, как днём.
find "$ROOT" -name '.env*' ! -name '.env.example' -not -path '*/node_modules/*' -not -path '*/.git/*' -type f |
  while read -r f; do
    rel="${f#"$ROOT"/}"
    mkdir -p "$TREE/$(dirname "$rel")"
    cp "$f" "$TREE/$rel"
  done

ARGS=(-p "Выполни docs/OVERNIGHT.md от начала до конца. Ты в ветке $BRANCH. Будь самостоятельным: решения принимай сам, вопросов не задавай, всё записывай в docs/NIGHT-LOG.md." --permission-mode "$MODE")
[[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")
[[ -n "$BUDGET" ]] && ARGS+=(--max-budget-usd "$BUDGET")

echo "Ветка:    $BRANCH"
echo "Worktree: $TREE"
echo "Журнал:   $LOG"
echo "Утром: прочитай docs/NIGHT-LOG.md в worktree и запусти /hard-review по ветке $BRANCH."

cd "$TREE"
# caffeinate не даёт macOS уснуть, пока идёт работа; на Linux запускаем как есть.
rc=0
if command -v caffeinate >/dev/null; then
  caffeinate -dims claude "${ARGS[@]}" >"$LOG" 2>&1 || rc=$?
else
  claude "${ARGS[@]}" >"$LOG" 2>&1 || rc=$?
fi
echo "Готово, код выхода $rc. Журнал: $LOG"
