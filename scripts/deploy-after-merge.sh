#!/usr/bin/env bash
# 自举开发 merge 成功后的自动部署：由 backend 在 merge 完成后 detached 触发。
# 幂等、flock 串行化、按改动范围增量重建，最后提交 dist 产物保持仓库 clean。
set -euo pipefail

cd /www/wwwroot/ai-workflow-platform
export PATH=/usr/local/node24/bin:$PATH

LOG=/www/wwwlogs/ai-workflow-autodeploy.log
exec 9>/tmp/ai-workflow-autodeploy.lock
flock -n 9 || { echo "[$(date '+%F %T')] another deploy in progress, skip" >> "$LOG"; exit 0; }

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

log "=== auto deploy start (HEAD=$(git rev-parse --short HEAD)) ==="

# merge commit：HEAD^1 是合并前的 main，diff 即本次自举引入的改动
# quotepath=false：中文目录默认被 git 转义成八进制，会导致 grep 匹配不上
CHANGED=$(git -c core.quotepath=false diff --name-only HEAD^1 HEAD || true)
BACKEND_CHANGE=$(echo "$CHANGED" | grep -E '^(后端|共享类型)/' || true)
FRONTEND_CHANGE=$(echo "$CHANGED" | grep -E '^(前端|共享类型)/' || true)

if [ -z "$BACKEND_CHANGE$FRONTEND_CHANGE" ]; then
  log "no source changes detected, nothing to do"
  exit 0
fi

if [ -n "$FRONTEND_CHANGE" ]; then
  log "frontend changes detected, rebuilding both bundles"
  (cd 前端 && VITE_BASE=/ai-workflow/ VITE_API_BASE_URL=/ai-workflow/api/ npx vite build --outDir dist) >> "$LOG" 2>&1
  (cd 前端 && VITE_BASE=/ VITE_API_BASE_URL=/api/ npx vite build --outDir dist-root) >> "$LOG" 2>&1
fi

if [ -n "$BACKEND_CHANGE" ]; then
  log "backend/shared changes detected, rebuilding shared-types and backend"
  npm run -s build --workspace=@ai-workflow/shared-types >> "$LOG" 2>&1
  (cd 后端 && npm run -s build) >> "$LOG" 2>&1
fi

git add -f 前端/dist 前端/dist-root 后端/dist >> "$LOG" 2>&1
if git diff --cached --quiet; then
  log "no dist changes to commit"
else
  git commit -m "build: auto rebuild after self-development merge" >> "$LOG" 2>&1
fi

pm2 restart ai-workflow-backend >> "$LOG" 2>&1
log "=== auto deploy done ==="
