#!/usr/bin/env bash
# Детерминированные гарантии (exit 2 = блок + ошибка агенту). См. INFRA.md §6.
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# 1. Деструктивные команды — блок всегда
echo "$CMD" | grep -qiE 'rm -rf /|drop (table|schema|database)|truncate |git push .*--force|supabase db reset' \
  && { echo "BLOCKED: деструктивная команда" >&2; exit 2; }

# 2. Чтение секретов — блок
echo "$CMD" | grep -qE '(cat|less|grep|scp).*\.env($|[^.])' \
  && { echo "BLOCKED: секреты не читаем" >&2; exit 2; }

# 3. Деплой только при зелёных тестах (deploy.sh пишет маркер)
if echo "$CMD" | grep -q 'deploy.sh'; then
  [ -f "$CLAUDE_PROJECT_DIR/.claude/state/tests-green" ] || { echo "BLOCKED: деплой без зелёных тестов" >&2; exit 2; }
fi
exit 0
