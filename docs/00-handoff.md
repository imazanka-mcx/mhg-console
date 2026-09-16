# mhg-console — project handoff

For a fresh session working on the MHG Corporate Console. Read this first, then
`docs/01-architecture.md` in the repo, which is canonical for the design. This
file carries what that one does not: current state, working conventions, and
the environment traps that have already cost time.

---

## 1. What it is

The **registry plane** for the MHG platform. System of record for properties,
groups, people and the Inn Code Standard. It is not a multi-property PMS, and
the difference is the whole point.

```
REGISTRY   mhg-console      properties, groups, people, brands, standards, codes
AUTHOR     mhg-inspiredrev  rates, restrictions, inventory controls, yield
EVALUATE   mhotels-inspire  the booking gate — runs with central DOWN
TRANSACT   mhotels-inspire  folio, all A/R
```

Two invariants everything else depends on:

- **R1 — identity flows down.** The console publishes it; Inspire and
  InspiredREV consume it. Neither writes identity back up. (Operational truth —
  rooms, occupancy, pickup — still flows *up*. Those are different things, and
  `docs/01 §6` reconciles them.)
- **R2 — the console is never on the critical path.** Consumers mirror the
  registry and run from their mirror. Console down must never mean a guest
  cannot check in.

**The discipline test** for anything proposed: *if it changes one guest's stay,
it is PMS. If it changes what the portfolio does, it is console.*

---

## 2. Repos

| Repo | What |
|---|---|
| `mhg-console` | This. Next 14 + Prisma + its own Neon. Docs-first: `docs/01-architecture.md`. |
| `mhg-icgenerator` | `@mcx/inn-code` — the Inn Code Standard as a library. Consumed here as a **git dependency pinned to a tag** (currently `v1.1.0`). |
| `mhotels-inspire` | The PMS. |
| `mhg-inspiredrev` | Above-property rates/inventory/yield. |

All under the personal GitHub account **`imazanka-mcx`** (no organization), on
`~/Desktop/mcx_ecosystem/mhg_ecosystem/`. Remotes use the `github-mcx` SSH alias.

**`@mcx/inn-code` is NOT on a package registry.** GitHub Packages requires the
npm scope to match the owning account, and `@mcx` ≠ `imazanka-mcx`. It installs
from git at a tag, with a `prepare` script that builds `dist/` on install.
Bumping it means: commit there → tag → `git push --follow-tags` → bump the ref
in this repo's `package.json`. Vercel will need a deploy key or PAT to clone it.

---

## 3. Running it

Node **22.6+** — everything runs TypeScript directly through Node's type
stripping, no build step and no test dependency. `.nvmrc` pins it.

```bash
nvm use
npm install
npm test                 # node:test, currently 69
npm run typecheck
npm run dev
```

`.env` needs three keys (see `.env.example`): `DATABASE_URL` (Neon pooled),
`DIRECT_URL` (Neon unpooled — Prisma migrations need it), and `AUTH_SECRET`
(32+ chars; signs the session cookie, rotating it signs everyone out). **Next
reads `.env` only at boot** — restart the dev server after changing it.

First-time setup of a fresh database:

```bash
npx prisma migrate dev --name init
npm run db:seed                                   # role + permission catalog
npm run sunrise -- --email you@… --name "Your Name" --confirm
```

Other commands:

- `npm run issue` — the inn code CLI (`propose`, `issue`, `rebrand`, `status`,
  `list`). Writes need `--confirm`.
- `npm run groups` — the group CLI (`list`, `show`, `new`, `add`, `remove`,
  `sync`). Writes need `--confirm`; `show` prints who a membership change
  would affect before it changes.
- `npm run verify:groups` — **read-only.** Audits group-backed access against
  the live registry: capped permissions held above property, grants pointing at
  a group or code that does not exist, rule groups that have drifted, and group
  grants that reach nothing. Safe to run any time; this is the Oversight
  exception list in script form.
- `npm run verify:constraints` — proves the uniqueness guarantees against a
  real Postgres. **Refuses** any target that is not a local `*_test`/`*_dev`
  database, because it drops every registry table.

---

## 4. Where it stands

Built and **verified end to end against the live Neon database**:

- **The registry.** `property` (the hotel, keyed on an immutable id) and
  `inn_code` (the ledger — one row per code ever issued, never deleted), plus
  `market_claim`. `PrismaRegistry` implements the library's `Registry` port.
- **Issuance.** `src/issuance.ts` is the one path that issues a code. CLI and
  UI both go through it.
- **The New Property flow.** `/portfolio` and a two-step claim: propose reads
  and shows the rule path, claiming is a separate explicit act.
- **Identity and access.** `person` / `role` / `permission` / `grant` /
  `audit_event`. `npm run sunrise` creates the first account and refuses once
  any person exists; that account holds `owner` at portfolio scope and
  provisions everyone else, including other owners.
- **Groups** (`docs/01 §2.2`). `property_group` / `property_group_member`,
  manual and rule-backed, materialized either way. The `group` scope now has
  something to point at: a group grant reaches every property in the group, and
  redrawing the group touches no grant. Sections: `/groups` with rule preview,
  `/groups/[id]` with membership editing and a "who this group grants" panel.
  The People form picks a real group instead of accepting typed text, and
  `grantAccess` refuses a `scope_ref` that resolves to nothing.

  **Authored on Linux, so two steps must run on the Mac before this is live:**
  the migration in `prisma/migrations/*_groups` is hand-written (the schema
  engine cannot run in the Cowork VM) and the client has not been regenerated.
  Run `npx prisma migrate dev && npm run db:seed && npm run typecheck`. Until
  `prisma generate` runs, `typecheck` reports ~32 errors, all of them the
  missing `propertyGroup` / `propertyGroupMember` delegates or a cascade from
  them; `npm test` is unaffected and passes, because every test here is
  database-free by design.

**Open, in priority order:**

1. **Inspire's role migration** (`§4 step 5`). Its `Role` enum, `RANK` and
   `MODULE_ACCESS` become rows here; its `UserPropertyRole` rows become grants
   at property scope. Payoff: the A/R permissions are *already* seeded capped,
   so the `corporate_admin`-has-A/R-at-every-property hole closes the moment
   Inspire reads from here — and with groups built, a Regional DOO now has a
   scope to be granted at, which was the other half of that problem (§2.6).
2. **Invert the directory sync** (`§6`). Highest risk; shadow it first.
3. **Strip the PMS screens** from Inspire's `/corporate`.
4. **Decide what `grant.scope_ref` holds at property scope** — the inn code
   (today) or the internal id. `docs/01 §5` states the three options. Nothing
   forces it until the first rebrand of a hotel somebody holds a property grant
   on.

**No Vercel project yet** — deliberately. Deploy when there is a reason to;
that is also when the private-dependency credential and `AUTH_SECRET` as an
environment variable are needed.

---

## 5. Decisions that should not be re-litigated

Each of these was argued once. The reasoning matters more than the conclusion.

- **The console is its own deployable**, not a section of Inspire. Inside
  Inspire, "console down" and "Inspire down" are the same event, so R2 is
  unsatisfiable — and a registry living in Inspire's schema means Inspire owns
  identity, which is the problem this app exists to fix.
- **Regions are group membership, not schema.** Scope is
  `portfolio | group | property`, permanently. A region is a manual group; a
  brand is a rule-backed one. Adding an above-property axis must be a row, never
  a migration. This is why region boundaries can stay undecided indefinitely.
- **The firewall is a constraint, not a convention.** `permission.scopeMax`
  caps `ar.view`, `ar.manage`, `folio.post` at `property`; `grantAccess`
  refuses any role carrying them at wider scope. A one-property group still
  counts as above property — cardinality is not the test, being a set is.
- **Regions are membership, and membership is keyed on the property id.** Keyed
  on the inn code, a rebrand would silently drop a hotel out of its region;
  keyed on the id, group coverage survives a code change for free (G1, G2).
  Resolution reads the current code through the membership row.
- **Rule groups materialize into rows, never evaluate on read.** A live
  predicate is not inspectable, and access resolution would have two shapes
  depending on how a property got in. The cost is drift, which is why
  `synced_at` exists, issuance re-materializes, and `verify:groups` checks it.
- **Archiving a group does not stop it resolving.** Access is closed by closing
  a grant. Otherwise a display action would silently revoke people.
- **Groups do not nest.** A property is in many groups, flat. Nesting brings
  back the single-parent hierarchy §2.2 exists to avoid.
- **Codes are derived, never typed**, and claiming is separate from proposing,
  because a claim is permanent (G3, M7) and there is no undo.
- **`inn_code` is a ledger.** A rebrand *adds* a row and retires the old one;
  the property keeps its id (G1, G2). Uniqueness fires against history.
- **OpsCore is out of scope** (`§1.6`). Standalone program, not a platform
  participant. The registry holds nothing about it; the inn code is the only
  thing that travels, as a human-facing label.
- **The session guard is a layout, not middleware.** Middleware runs without a
  database — it can confirm a token parses, not whether the person is still
  active or still holds anything.
- **Tests use `node:test`**, not vitest. No test dependency, runs under type
  stripping. Deliberate divergence from `mhg-icgenerator`.

---

## 6. Environment traps

These have each bitten at least once.

- **Never `npm install` into the repo from a Linux VM.** Both `mhg-icgenerator`
  and this repo hold macOS binaries; a Linux install replaces them and breaks
  the Mac. The generator's `DEPLOY.md` says so explicitly.
- **Prisma's generated client is `darwin-arm64`.** Anything touching it must run
  on the Mac.
- **`next/headers` resolves only inside the Next bundler.** Anything a CLI
  reaches must not import it — this broke `sunrise` once.
  `test/cli-imports.test.ts` walks the import graph and fails on it now.
- **Node parameter properties** (`constructor(private x: T)`) are not strippable.
  Declare fields explicitly.
- **`.env` cannot be written by remote tooling** (policy). It must be edited on
  the Mac.
- **Prisma cannot run at all in the Cowork VM.** `prisma migrate` / `generate`
  try to fetch `linux-arm64` engines and get a 403 through the proxy — and
  letting them succeed would be worse, since generating for a Linux target
  would replace the `darwin-arm64` client the Mac needs. Author the migration
  SQL by hand there and apply it on the Mac; `npm test` still runs in the VM
  because nothing under `test/` touches a database.
- In the Cowork VM, git cannot delete its own lock files without folder delete
  permission; a stale `.git/*.lock` surfaces as "Another git process seems to be
  running" when none is.

---

## 7. Conventions

- **Commit style**: lowercase `new:` / `update:` / `fix:` prefixes, several
  lines per commit where warranted, body explaining *why*. Matches the sibling
  repos. Every build or update should end with a paste-ready commit message.
- **Docs are part of the change.** `docs/01-architecture.md` is canonical and
  gets updated in the same commit as the code it describes, including what the
  implementation forced that the spec had not anticipated.
- **Verification is stated honestly** — what ran, what did not, and why. A
  claim like "the constraints hold under concurrency" should be backed by
  something that actually ran two writers at once. Where a check would
  otherwise need throwaway grants, prefer a read-only audit of real rows
  (`npm run verify:groups`) over polluting an audit trail that is supposed to
  mean something.
