#!/usr/bin/env bash
# 从当前分支整条历史上移除 Cursor Co-authored-by 行（慎用：会改写所有 commit hash）
set -euo pipefail
export FILTER_BRANCH_SQUELCH_WARNING=1
git filter-branch -f --msg-filter '
  sed -e "/^Co-authored-by: Cursor <cursoragent@cursor.com>$/d" \
      -e "/^Co-authored-by: Cursor <cursoragent@cursor.com>/d"
' -- --all
git for-each-ref --format="%(refname)" refs/original/ | while read -r ref; do
  git update-ref -d "$ref" 2>/dev/null || true
done
git reflog expire --expire=now --all
git gc --prune=now
echo "Done. Verify: git log -5 --format=%B"
echo "Then push: git push --force-with-lease origin main"