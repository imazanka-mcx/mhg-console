#!/usr/bin/env bash
#
# Vercel build step (DEPLOY.md §4).
#
# Three things in order, and the middle one is conditional on purpose.
set -euo pipefail

# The client is generated per build rather than committed: it is machine
# specific, and a stale one is a class of bug that only shows up in production.
npx prisma generate

# Migrations run ONLY on a production deploy.
#
# A preview deploy is somebody's branch. Letting it run `migrate deploy` would
# let an unmerged schema change reach the production registry by opening a pull
# request — and this database is a system of record whose claims are permanent
# (G3, M7). Previews point at the dev branch and are migrated from a laptop,
# which is where `migrate dev` belongs anyway.
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "→ VERCEL_ENV=production — applying migrations"
  npx prisma migrate deploy
else
  echo "→ VERCEL_ENV=${VERCEL_ENV:-unset} — skipping migrations (see scripts/vercel-build.sh)"
fi

npx next build
