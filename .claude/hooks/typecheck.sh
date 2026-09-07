#!/usr/bin/env bash
# После любой правки кода: сбросить маркер зелёных тестов (деплой снова требует прогона тестов)
# и по возможности прогнать быстрый typecheck. См. INFRA.md §6.
rm -f "$CLAUDE_PROJECT_DIR/.claude/state/tests-green"

# Быстрый typecheck, если проект уже инициализирован (package.json есть).
if [ -f "$CLAUDE_PROJECT_DIR/package.json" ]; then
  cd "$CLAUDE_PROJECT_DIR" && pnpm --silent typecheck 2>&1 | tail -n 20 || true
fi
exit 0
