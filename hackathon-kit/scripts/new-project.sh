#!/usr/bin/env bash
# Разворачивает проект хакатона из шаблонов комплекта и харнесса Claude Code в отдельный git-репозиторий.
#   scripts/new-project.sh <name> <template> [<template2>] [--dest <dir>]
#   шаблоны: web-game-3d | ai-service | none; два шаблона дают монорепо apps/web + apps/ai
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  sed -n '2,4p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 1
}

[[ $# -ge 2 ]] || usage
NAME="$1"
shift
TEMPLATES=()
DEST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      [[ $# -ge 2 ]] || usage
      DEST="$2"
      shift 2
      ;;
    web-game-3d | ai-service) TEMPLATES+=("$1"); shift ;;
    none) shift ;;
    *) echo "Неизвестный аргумент: $1" >&2; usage ;;
  esac
done

[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Имя проекта — kebab-case: a-z, 0-9, -" >&2; exit 1; }
[[ ${#TEMPLATES[@]} -le 2 ]] || { echo "Не больше двух шаблонов" >&2; exit 1; }
if [[ ${#TEMPLATES[@]} -eq 2 && "${TEMPLATES[0]}" == "${TEMPLATES[1]}" ]]; then
  echo "Шаблоны не должны повторяться" >&2
  exit 1
fi
DEST="${DEST:-$KIT/projects/$NAME}"
[[ -e "$DEST" ]] && { echo "Уже существует: $DEST" >&2; exit 1; }
# ${arr[@]+...}: пустой массив под set -u в bash 3.2 (системный на macOS) иначе падает
for t in ${TEMPLATES[@]+"${TEMPLATES[@]}"}; do
  [[ -d "$KIT/templates/$t" ]] || { echo "Нет шаблона: $KIT/templates/$t" >&2; exit 1; }
done

EXCLUDES=(
  --exclude node_modules --exclude .venv --exclude dist --exclude __pycache__
  --exclude .pytest_cache --exclude .cache --exclude .vercel --exclude .DS_Store
  --exclude '.env' --exclude '.env.local' --exclude '.env.*.local'
)

copy_template() {
  mkdir -p "$2"
  rsync -a "${EXCLUDES[@]}" "$KIT/templates/$1/" "$2/"
}

app_dir() {
  case "$1" in
    web-game-3d) echo web ;;
    ai-service) echo ai ;;
  esac
}

mkdir -p "$DEST"
if [[ ${#TEMPLATES[@]} -eq 1 ]]; then
  copy_template "${TEMPLATES[0]}" "$DEST"
elif [[ ${#TEMPLATES[@]} -eq 2 ]]; then
  for t in "${TEMPLATES[@]}"; do
    copy_template "$t" "$DEST/apps/$(app_dir "$t")"
  done
fi

# Харнесс: правила режима хакатона, скиллы, агенты и факты. Гипотезы кейсов остаются в комплекте.
cp "$KIT/harness/CLAUDE.md" "$DEST/CLAUDE.md"
mkdir -p "$DEST/.claude/context" "$DEST/docs"
rsync -a "$KIT/.claude/skills/" "$DEST/.claude/skills/"
rsync -a "$KIT/.claude/agents/" "$DEST/.claude/agents/"
# Guard-хук (блокирует force-push, reset --hard, коммит .env, ключи в коде) и ночной запуск.
rsync -a "$KIT/harness/claude/" "$DEST/.claude/"
chmod +x "$DEST/.claude/hooks/guard.py" "$DEST/.claude/bin/overnight.sh"
for f in "$KIT"/.claude/context/*.md; do
  [[ "$(basename "$f")" == case-hypotheses.md ]] || cp "$f" "$DEST/.claude/context/"
done

if [[ ! -f "$DEST/.gitignore" ]]; then
  cat > "$DEST/.gitignore" <<'EOF'
.DS_Store
.env
.env.*
!.env.example
node_modules/
.venv/
dist/
__pycache__/
docs/media/raw/
EOF
fi

if [[ ! -f "$DEST/LICENSE" ]]; then
  cat > "$DEST/LICENSE" <<EOF
MIT License

Copyright (c) $(date +%Y) ${TEAM_NAME:-$NAME team}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
fi

cd "$DEST"
git init -q -b main
git add -A
label="none"
[[ ${#TEMPLATES[@]} -gt 0 ]] && label="$(IFS=+; echo "${TEMPLATES[*]}")"
if ! git commit -q -m "chore: scaffold from team starter template ($label)"; then
  echo "Не удалось сделать первый коммит: проверь git config user.name и user.email" >&2
  exit 1
fi

echo "Готово: $DEST"
echo "Дальше: README шаблона → установка зависимостей → запуск в mock-режиме → /kickoff, шаг 3."
