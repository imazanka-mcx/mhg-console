# MHG Corporate Console

The **registry plane** for the MHG platform: system of record for properties,
property groups, people, access grants, brands and the MHG Inn Code Standard.

A PMS answers *what is happening to this stay, at this property*. This app
answers *what is in the portfolio, who is in it, and how is it running*. Those
are different nouns, which is why this is its own deployable and not a section
of Inspire.

```
REGISTRY   mhg-console      properties, groups, people, brands, standards, codes
AUTHOR     mhg-inspiredrev  rates, restrictions, inventory controls, yield
EVALUATE   mhotels-inspire  the booking gate — runs with central DOWN
TRANSACT   mhotels-inspire  folio, all A/R
```

**Read `docs/01-architecture.md` before writing any code in this repo.** It
carries the two invariants everything else depends on (identity flows down;
this app is never on the critical path), the property shell contract, the
access model, and the migration order.

## Status

Phase 0 — architecture settled, nothing built. Next: `PrismaRegistry` against
`@mcx/inn-code` (`docs/01 §4` step 1).

## Running it

Node 22.6 or newer — everything here runs TypeScript directly through Node's
type stripping, with no build step and no test dependency. `.nvmrc` pins it:

```bash
nvm use            # Node 22
npm install
npm test           # 15 tests, node:test
npm run typecheck
npm run issue      # the inn code CLI — see docs/01 §4
npm run groups     # the group CLI — see docs/01 §2.2
npm run verify:groups   # read-only audit of group-backed access
```

## Stack

Next.js + Prisma + its own Neon Postgres, on its own Vercel project — the same
topology as `mhg-inspiredrev`, and for the same reason. Target domain:
`console.mazcoenterprises.com`.

It never reads Inspire's or InspiredREV's database. Identity is published to
them as events; they mirror it and run from their own copy.

## Siblings

| Repo | What |
|---|---|
| `mhotels-inspire` | The PMS. Consumes identity; owns the stay. |
| `mhg-inspiredrev` | Above-property rates/inventory/yield. Consumes identity; authors rates. |
| `mhg-icgenerator` | `@mcx/inn-code` — the Inn Code Standard as a library. Installed here as a git dependency pinned to a tag; see `docs/01 §4` step 0. |

OpsCore is **not** part of this platform — it is a standalone program that
offers integrations. See `docs/01 §1.6`.
