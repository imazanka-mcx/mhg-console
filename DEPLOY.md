# Deploying the MHG Corporate Console

Target: **https://mhgconsole.mazcoenterprises.com**, on Vercel, against Neon.

Read `docs/01-architecture.md` for what the app is. This file is only how it
gets to a URL, and why the arrangement is shaped the way it is.

One thing worth stating before the steps, because it governs several of them:
**R2 says the console is never on the critical path.** Deploying it does not
change that. Inspire and InspiredREV mirror the registry and run from their
mirror; this URL going down must never mean a guest cannot check in. Nothing
here should ever grow into a request-time dependency for them.

---

## 1. What has to exist

| Thing | Where | Why |
|---|---|---|
| Neon `production` branch | already exists (the project's default) | the production registry — migrated and seeded, with the sunrise owner account already on it |
| Neon `dev` branch | §2 | so local work cannot burn a code in the system of record |
| Fine-grained GitHub PAT | §3 | Vercel cannot clone the private `@mcx/inn-code` over SSH |
| Vercel project | §4 — **done 2026-09-16** | |
| DNS record | §5 — **done 2026-09-16** | |

---

## 2. Split Neon

The project's default branch is called **`production`** — that is the database
`npm run sunrise` and every migration so far have run against. It keeps that
job. Local moves to a branch off it.

1. Neon console → the console's project → **Branches** → **New branch**.
   - Name: `dev`
   - **Auto-delete: Never.** The field defaults to a short expiry because it is
     meant for throwaway preview branches. This one holds your local
     development; letting it expire leaves `.env` pointing at a host that no
     longer resolves.
   - Parent: `production` (currently `ep-tiny-firefly-aeu5urar`, `us-east-2`)
   - **Branch data and schema** — yes, data — branching copies at the branch point, so the dev
     branch starts with the real portfolio and your existing account rather
     than an empty registry you would have to sunrise again.
2. Copy the dev branch's two connection strings: the **pooled** one (host ends
   `-pooler`) and the **direct** one.
3. In local `.env`, replace `DATABASE_URL` / `DIRECT_URL` with the dev pair.
   Next reads `.env` only at boot — restart `npm run dev`.

After this, the split is: `migrate dev` on a laptop moves the **dev** branch;
the `production` branch is migrated by the Vercel build (§4). They do not cross.

A consequence worth saying out loud: from here, **nothing you type advances the
production schema.** Only a production deploy does. That is the intent — it is
also why production should be left in a known-good state, which it currently is.

**Branches drift.** The dev branch is a snapshot, not a mirror. When it has
drifted far enough to stop being useful, delete it and branch again — that is
cheaper than reconciling two registries, and nothing of value lives only on
dev. Re-branching mints a **new endpoint host**, so local `.env` and the Vercel
Preview variables both need the new strings. That is the standing cost of the
split, and it is small.

---

## 3. The private dependency

`package.json` pins `@mcx/inn-code` to a tag over SSH:

```json
"@mcx/inn-code": "git+ssh://git@github.com/imazanka-mcx/mhg-icgenerator.git#v1.1.0"
```

That works on your Mac because your SSH key reaches `imazanka-mcx`. Vercel's
build container has no key. The credential must therefore live in the
environment, never in `package.json` — where it would be committed, and where
rotating it would be a commit.

1. GitHub → Settings → Developer settings → **Fine-grained personal access
   tokens** → Generate new token.
   - Resource owner: `imazanka-mcx`
   - Repository access: **Only select repositories** → `mhg-icgenerator`
   - Permissions: **Contents: Read-only**. Nothing else.
   - Expiry: set one. A token with no expiry is a credential nobody ever
     revisits.
2. Add it to Vercel as `INN_CODE_TOKEN` (§4), for **all three** environments.
3. `scripts/vercel-install.sh` rewrites `ssh://git@github.com/` to HTTPS with
   that token for the length of the build, then runs `npm ci`. The rewrite goes
   into the container's throwaway `~/.gitconfig`, not into the repo.

**When the token expires, the build fails at install with a permission error
that looks like a broken SSH key.** That is this, not your key.

Bumping the library is unchanged: tag in `mhg-icgenerator`,
`git push --follow-tags`, bump the ref here.

---

## 4. The Vercel project

Import `imazanka-mcx/mhg-console`. Framework preset: Next.js.

**Do not override the install or build commands in the dashboard** —
`vercel.json` sets both, so they stay reviewable in a diff:

```
installCommand  bash scripts/vercel-install.sh
buildCommand    bash scripts/vercel-build.sh
```

**Node version:** 22.x. Vercel reads `engines.node` from `package.json`, not
`.nvmrc`, which is why that field now exists.

**Function region:** set it to **Cleveland (`cle1`)**. Neon is in
`us-east-2`, and the default `iad1` puts every query on a cross-region round
trip for no reason. This app resolves grants from the database on every
request (`docs/01 §2.6`), so that latency lands on every page.

### Environment variables

Scope them per environment — this is the half of the Neon split that lives on
Vercel's side, and getting it wrong is how a preview deploy writes to the
production registry.

| Variable | Production | Preview + Development |
|---|---|---|
| `DATABASE_URL` | Neon **`production`**, pooled | Neon **`dev`**, pooled |
| `DIRECT_URL` | Neon **`production`**, direct | Neon **`dev`**, direct |
| `AUTH_SECRET` | its own `openssl rand -base64 48` | a different one |
| `INN_CODE_TOKEN` | the PAT from §3 | the same PAT |

`AUTH_SECRET` is deliberately not shared with your laptop. It signs the session
cookie and nothing else; separate values mean a local session and a production
session are simply unrelated. Rotating it signs everyone out of that
environment, which is the emergency lever if a cookie is ever suspect.

### What the build does

`scripts/vercel-build.sh`, in order:

1. `prisma generate` — every build, because the client is machine-specific and
   a stale one fails in production rather than at build.
2. `prisma migrate deploy` — **only when `VERCEL_ENV=production`.** A preview
   is somebody's branch; letting it migrate would mean opening a pull request
   could reach the production registry. Previews point at the dev branch and
   are migrated from a laptop.
3. `next build`.

---

## 5. DNS

Vercel → Project → Settings → Domains → add `mhgconsole.mazcoenterprises.com`.

At whoever holds `mazcoenterprises.com`. **The target is project-specific** —
Vercel no longer hands out the generic `cname.vercel-dns.com` for new projects,
so take the value from Vercel's Domains tab rather than from any runbook,
including this one. What this project resolved to, as of 2026-09-16:

```
CNAME   mhgconsole   b28e2d374f123233.vercel-dns-017.com.
```

Two things that waste an afternoon here. The host field is `mhgconsole`, not
the full name — most DNS panels append the zone to whatever you type, and
typing it out gives you `mhgconsole.mazcoenterprises.com.mazcoenterprises.com`,
which resolves to nothing and looks like propagation lag. And propagation lag
is real: until it clears, the name genuinely does not resolve anywhere, so
"name or service not known" is not evidence that the record is wrong.

Vercel issues the certificate once the record resolves.

**Live and verified 2026-09-16:** the domain serves `/login` over HTTPS.

---

## 6. First deploy — done 2026-09-16

There is **no sunrise step.** `npm run sunrise` refuses once any person exists,
and the production branch already holds your owner account — it is the same
database you have been signing into locally. Go to the URL and sign in.

Then, from your Mac with `.env` still pointing at production for one command,
or from the Vercel deployment logs:

- `npm run verify:groups` — read-only. Four ✓ and "no exceptions".
- Sign in, load `/portfolio`, `/groups`, `/people`.

If `/groups` 500s with a missing table, `migrate deploy` did not run — check
that the deploy was a production one and not a preview.

---

## 7. What is deliberately not here

- **No cron, no background jobs.** Nothing in the registry needs to happen on a
  schedule yet. Rule groups re-materialize on issuance and on demand.
- **No preview database seeding.** Previews share the dev branch. If that
  becomes a problem, the answer is a branch per preview, not a shared scratch
  database.
- **No mirroring to Inspire or InspiredREV.** That is `docs/01 §6`, and it is
  the highest-risk step in the migration order precisely because it inverts a
  direction that currently works. Shadow it before switching it.
