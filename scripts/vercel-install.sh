#!/usr/bin/env bash
#
# Vercel install step (DEPLOY.md §3).
#
# `@mcx/inn-code` is a git dependency on a PRIVATE repo, pinned to a tag
# (docs/01 §4 step 0). Vercel's build container has no SSH key and no access to
# imazanka-mcx, so the ssh:// URL in package.json cannot be cloned as written.
#
# Rather than putting a credential in package.json — where it would be
# committed, and where rotating it would be a commit — git is told to rewrite
# github.com URLs to HTTPS with a read-only token for the length of the build.
# The token lives in Vercel's environment; ~/.gitconfig here is thrown away
# with the container.
set -euo pipefail

if [ -z "${INN_CODE_TOKEN:-}" ]; then
  echo "✗ INN_CODE_TOKEN is not set." >&2
  echo "  @mcx/inn-code lives in a private repo and cannot be cloned without it." >&2
  echo "  Add it in Vercel → Settings → Environment Variables (see DEPLOY.md §3)." >&2
  exit 1
fi

# Two spellings, because npm normalizes a git dependency differently depending
# on how it was written. Matching only one of them fails at install with a
# permission-denied that reads like a broken SSH key.
git config --global       url."https://${INN_CODE_TOKEN}@github.com/".insteadOf "ssh://git@github.com/"
git config --global --add url."https://${INN_CODE_TOKEN}@github.com/".insteadOf "git@github.com:"

npm ci
