#!/usr/bin/env python3
"""PreToolUse guard for hackathon projects.

Blocks the few actions that can lose work or leak keys at 3am (or overnight, when nobody watches):
force-push, hard reset, mass discard, deleting main, committing .env, skipping git hooks,
`rm -rf` on the project/home/root, and writing API keys or tokens into tracked files.
Exit code 2 blocks the tool call; stderr is shown to the model as the reason.
"""

from __future__ import annotations

import json
import re
import sys

SECRET = re.compile(r"sk-ant-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}")

BASH_RULES: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\bgit\b[^|;&]*\bpush\b[^|;&]*(\s--force(?!-with-lease)\b|\s-f\b|\s\+\S)"),
        "force-push запрещён: используй --force-with-lease и только в своей ветке",
    ),
    (re.compile(r"\bgit\b[^|;&]*\bpush\b[^|;&]*(--delete|\s:)\s*(main|master)\b"), "удалять main на remote нельзя"),
    (re.compile(r"\bgit\b[^|;&]*\bbranch\b[^|;&]*\s-D\s+(main|master)\b"), "удалять main нельзя"),
    (
        re.compile(r"\bgit\b[^|;&]*\breset\b[^|;&]*--hard\b"),
        "git reset --hard теряет работу: используй git stash или новую ветку",
    ),
    (
        re.compile(r"\bgit\b[^|;&]*\bclean\b[^|;&]*\s-[a-zA-Z]*f"),
        "git clean -f удаляет неотслеживаемые файлы безвозвратно",
    ),
    (
        re.compile(r"\bgit\b[^|;&]*\b(checkout|restore)\b[^|;&]*\s(--\s+)?\.(\s|$)"),
        "откат всех изменений разом запрещён: откатывай конкретные файлы",
    ),
    (
        re.compile(r"\bgit\b[^|;&]*\b(commit|push|merge)\b[^|;&]*--no-verify\b"),
        "--no-verify запрещён: почини проверку, а не обходи её",
    ),
    (
        re.compile(r"\bgit\b[^|;&]*\badd\b[^|;&]*(\s-f\b|\s--force\b)"),
        "git add -f обходит .gitignore: проверь, что добавляешь не секреты и не мусор",
    ),
    (
        re.compile(r"\bgit\b[^|;&]*\badd\b[^|;&]*(^|\s|/)\.env(?!\.example)(\.[\w.-]+)?(\s|$)"),
        ".env с ключами коммитить нельзя (только .env.example)",
    ),
    (
        re.compile(
            r"\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR])[a-zA-Z]*\s+(\S+\s+)*(/|~|\$HOME|\.|\.\.|\*|\./\*)(/)?(\s|$)"
        ),
        "rm -rf по корню, домашней папке или всему проекту запрещён",
    ),
]


def block(reason: str) -> None:
    print(
        f"[hackathon-guard] Заблокировано: {reason}. Если это действительно нужно, пусть человек выполнит команду сам.",
        file=sys.stderr,
    )
    sys.exit(2)


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return
    tool = event.get("tool_name", "")
    data = event.get("tool_input") or {}

    if tool == "Bash":
        command = str(data.get("command", ""))
        for pattern, reason in BASH_RULES:
            if pattern.search(command):
                block(reason)
        if SECRET.search(command) and not re.search(r">>?\s*\S*\.env(\.[\w.-]+)?\b", command):
            block("в команде есть ключ или токен: не передавай секреты в командах, храни их в .env")
    elif tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        path = str(data.get("file_path") or data.get("notebook_path") or "")
        if re.search(r"(^|/)\.env(\.[\w.-]+)?$", path) and not path.endswith(".env.example"):
            return
        text = json.dumps(data, ensure_ascii=False)
        if SECRET.search(text):
            block(f"в {path or 'файл'} попадает ключ или токен: секреты только в .env, в коде — переменные окружения")


if __name__ == "__main__":
    main()
