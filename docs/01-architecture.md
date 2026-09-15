# 01 — Corporate Console Architecture (MHG-CC v0.4)

**Status:** Phase 0 — settled, nothing built. Read this before writing any code in
this repo; it exists so the reasoning behind the registry plane, and the hard
constraints on what this app owns, don't have to be re-derived every session.

Depends on: MHG-IC v1.0 (Inn Code Standard) · `mhg-icgenerator` · `mhotels-inspire` ·
`mhg-inspiredrev`

> **v0.4:** §1.6 cut back — OpsCore is a standalone program that offers integrations,
> not a participant in this platform, so the registry holds nothing about it.
> **v0.3:** OpsCore question closed — not a shell consumer.
> **v0.2:** verified against the repos (§0). Brand examples corrected to the shipped
> MHG-flags-only table. §2 rewritten around property **groups** instead of regions.
> §6 added to reconcile with `mhg-inspiredrev/docs/01 §5`.

---

## 0. What the repos actually say

Read before the design, because four of these change it.

| Finding | Where | Effect |
|---|---|---|
| **G1 is already safe.** `Property.id` is a cuid; `code` is a separate field under `@@unique([orgId, code])`. | `mhotels-inspire/prisma/schema.prisma:89` | Rebrands (G2) are structurally survivable today. |
| **The property code field is free text.** "2–20 characters: letters, numbers, - or _", placeholder `MHOR`. | `corporate/properties/new/page.tsx` | Nothing enforces MHG-IC. The standard is a document the form has never heard of. |
| **The IC generator is already a library with a registry port.** `Registry` interface, `MemoryRegistry` + `FirestoreRegistry`, `deriveCode` vs. atomic `issueCode`, 70 tests. | `mhg-icgenerator/src/types.ts` | Absorbing it is **not a rewrite**. It is one new `PrismaRegistry implements Registry`. |
| **The brand table narrowed to MHG flags only** — `BC` BYX Collection, `LX` BYX Luxury, chain `MAZ`. Franchised houses under someone else's flag get no inn code. | `mhg-icgenerator/src/config/brands.ts` | Collapses the brand-model duplicate (§1.5). |
| **Identity currently flows *up*, pulled per property.** InspiredREV's directory row is filled by calling `GET /api/integration/v1/property` with an `isk_` key issued by that property's own Inspire. | `mhg-inspiredrev/docs/01 §9` | Direct conflict with a registry plane. Resolved in §6 — and it has a hard break, §6.2. |
| **InspiredREV already has scoped grants.** `Scope = chain \| brand \| property`, `AccessGrant` join table, multi-grant per user. | `mhg-inspiredrev/prisma/schema.prisma:169` | Half of §2 is built. In the wrong repo, with the wrong middle tier. |
| **Inspire has no middle tier at all.** `OrgRole = corporate_admin \| corporate_viewer`, and `roleAt()` returns `"admin"` at *every* property for corporate_admin. | `mhotels-inspire/src/lib/rbac.ts:28` | A Regional DOO can only be read-only-everywhere or full-admin-everywhere. See §2.6. |
| **`Role` is a Postgres enum.** Adding a role is a migration. | `schema.prisma:263` | No role packs, no versioning, permissions hardcoded in `rbac.ts`. |

---

## 1. The reframe, and the generator

### 1.1 Registry plane

The Corporate Console felt like a PMS because it lived inside one and inherited its
nouns. A PMS answers *what is happening to this stay, at this property*. This app
answers *what is in the portfolio, who is in it, how is it running* — different nouns
entirely.

So it becomes the **registry plane**: system of record for everything that exists
above a stay. This extends the tier rule in `mhotels-inspire/docs/29 §2` rather than
competing with it.

| Plane | System | Owns |
|---|---|---|
| **REGISTRY** | This app | Properties, groups, people, brands, standards, codes |
| **AUTHOR** | InspiredREV | Rates, restrictions, inventory controls, yield, partner registry |
| **EVALUATE** | Inspire, runs with central down | The booking gate |
| **TRANSACT** | Inspire, always | Folio, all A/R |

Two invariants:

- **R1 — Identity flows one way, downward.** This app publishes it; Inspire and
  InspiredREV consume it. Neither writes identity back up. Operational truth still
  flows up (§6), and systems outside this platform are outside R1 entirely (§1.6).
- **R2 — This app is never on the critical path.** Every consumer mirrors the registry
  locally and runs from its mirror. Console down = cannot open a property or change
  access. It must never mean cannot check a guest in or authenticate. Same reasoning
  as `mhg-inspiredrev/docs/01 §2`.

**R2 is the reason this is a separate deployable.** Inside Inspire, "console down" and
"Inspire down" would be the same event and R2 would be unsatisfiable by construction —
and a registry living in Inspire's schema would mean Inspire owns identity and everyone
pulls from it, which is the problem this app exists to fix.

**The discipline test** for any proposed screen: *if it changes one guest's stay, it is
PMS. If it changes what the portfolio does, it is console.*

### 1.2 Absorbing the generator

`@mcx/inn-code` already draws the right line — "the formula proposes, the registry
disposes." The only thing the standalone Firestore registry costs is that **the registry
of record is not the table the property actually lives in**, so G8 is a promise instead
of a constraint.

The work is one adapter:

```ts
class PrismaRegistry implements Registry {
  hasCode(code)                          // SELECT over property, ALL statuses (G3)
  getMarketClaim(marketCode)             // market_claim table (M7)
  findSubmarketCode(city, state, sub)    // M6
  claim(record, market)                  // ONE tx: insert property + market_claim
  setStatus(code, status)                // G2
  get / list
}
```

`claim()` becomes a single Postgres transaction against `UNIQUE(inn_code)` and
`UNIQUE(market_code)` — a stronger uniqueness guarantee than the Firestore transactional
create, not a weaker one. `ConflictError` → re-derive → retry already exists in the engine.

The New Property flow takes name / city / state / brand / submarket, shows the proposed
code with the rule trace that produced it (`M2 · B1`, `M2 → M5`), and issues on confirm —
or on a logged override. `deriveCode` can ship as a read-only "propose a code" preview.
Only this app issues.

### 1.3 The shell contract

The shell is **identity, not configuration** — the boundary that keeps this app from
drifting into being a PMS.

```json
{
  "propertyId": "clx...",              // immutable, never the code (G1)
  "innCode": "EVVBC",
  "propCode": "EVVBC",
  "predecessorCode": "",
  "name": "BYX Collection Evansville East",
  "brandCode": "BC",
  "chainCode": "MAZ",
  "marketCode": "EVV",
  "marketSource": "airport",           // the rule that produced it (M7 audit)
  "city": "Evansville", "state": "IN", "submarket": "",
  "franchisorCode": "EVVIN1502H58",    // cross-reference only, never an identifier (G5)
  "timezone": "America/Chicago",
  "currency": "USD",
  "groups": ["grp_midwest", "grp_byx_collection"],
  "status": "pipeline",
  "effectiveDate": "2026-09-11",
  "shellVersion": 3
}
```

Not in it, ever: room types, rooms, rate plans, tax config, GL mappings, market/source
codes, any A/R anything. Those are consumer-side. `businessDate` is not in it either —
that is operational state Inspire owns from the moment it stands the property up.

### 1.4 Distribution

Distribution is by event, never shared DB. Transactional outbox → webhook per consumer,
idempotent on `propertyId` + `shellVersion`, replayable from zero so a new consumer
backfills by consuming history. Each consumer materializes its own read model and runs
from it (R2). This app tracks per-property, per-system provisioning state and surfaces
it — the one operational screen that is legitimately console work, because it is about
the portfolio rather than a stay.

The shell stream has exactly two subscribers: **Inspire and InspiredREV**. Both are
MHG-only, both are in this ecosystem, both can be keyed on the registry's `propertyId`.
That is the whole list.

### 1.5 One brand table

`@mcx/inn-code`'s `BrandEntry` (`BC`/`LX`, chain `MAZ`) and Inspire's `Brand` model
(`BrandTier`, `endorsement`, the "[Name] by [House]" convention, placeholder code
`FLAG`) are the same concept modeled twice. Now that the IC table is MHG-flags-only,
there is no tension to resolve — just a duplicate.

This app owns it. Inspire's `Brand` rows become a mirror, and `Brand.code` should be
`BC`/`LX`. The house name that `mhotels-inspire/docs/18` parks in
`Organization.settings` "once decided" appears to be BYX; worth closing out in the same
pass.

### 1.6 What the registry does not own

**OpsCore is a standalone program with its own identity, not part of this platform.** It
offers integrations; MHG is one customer among others. The registry therefore holds
**nothing** about it — no shell subscription, no tenant mapping, no external-reference
table, no link status. An earlier draft proposed one; it was overreach and it failed the
discipline test in §1.1. An integration key at a property is property-level operational
configuration, and it already lives in the right place: `IntegrationKey { propertyId,
name: "OpsCore" }` on the Inspire property. Nothing here changes it.

**Where the two meet is the inn code, and that is sufficient.** G1 makes the code a
human-facing identifier rather than a key. An MHG property that uses OpsCore simply names
its tenant `EVVBC`. That is what the standard means by "the OpsCore tenant shares one
identifier from day one" — a label read by people across systems, never a foreign key
holding two schemas together. Zero coupling, and it works the same way for a franchisor
portal, an accounting package, or a vendor account.

The same applies to every other system MHG does not solely own — franchisor systems
(OnQ, Lightstay, which will never federate anyway), accounting, procurement. Out of
scope; the inn code is the only thing that travels.

---

## 2. Identity, access, and the regional problem

### 2.1 The three tables

- **`person`** — one row per human, org-wide, for life. Email as login. A GM moving
  properties is the same row. *Inspire's `AppUser` already is this* — the gap is not the
  person table.
- **`role`** — a named template from a versioned catalog, in **data, not a Postgres enum**.
- **`grant`** — `(person_id, scope, scope_ref, role, role_version, effective_from, effective_to, granted_by, reason)`.

Effective permission at a property = union of every active grant whose scope resolves to
it. **Union only, no deny rules** — deny logic is where RBAC becomes unauditable.

### 2.2 The regional problem: don't model regions

Regions are stuck because they are being treated as a *schema* decision when they are a
*membership* decision. The current shape makes that inevitable: `Scope = chain | brand |
property` with a nullable ref column per tier, so a new above-property axis is a
migration, a new nullable column, a new unique constraint, and a backfill. Nobody should
want to commit to region boundaries under those terms.

Separate the two concerns:

```
PropertyGroup {
  id, kind, name,
  membershipMode: manual | rule,
  ruleJson            // only when rule-backed
}
PropertyGroupMember { groupId, propertyId }   // materialized either way
```

Scope collapses to three values, permanently: **`portfolio` | `group` | `property`.**

- `brand` grants become group grants against **rule-backed** groups (`brandCode = 'BC'`),
  auto-maintained, behaving exactly as they do now.
- `region` becomes a **manual** group. Name it, drop properties in, change your mind
  weekly. No schema, no migration, no grant touched.
- If regions later become derivable (by state, by drive time, by whatever), flip
  `membershipMode` to `rule`. Still no grant touched.

What this buys, concretely:

- **The region decision stops blocking the build.** At today's portfolio size manual
  membership costs nothing; the rule engine is a later optimization.
- **A property belongs to many groups.** A single region hierarchy forces exactly one
  parent, which is the rigidity making this hard. A property can be in Midwest *and* a
  PIP transition group *and* a brand group at once.
- **Redrawing a region is editing a group**, not migrating grants. Nobody loses access
  during a reorg.
- **Ad-hoc groups are free** — a task force covering three hotels through a conversion,
  an auditor's assignment for one quarter. Same object, same machinery.

`kind` (`region` / `brand` / `entity` / `ad_hoc` / `audit`) is a reporting label and
carries **no meaning in permission evaluation**. That is deliberate: you can report
regional coverage without the permission engine ever needing to know what a region is.

Groups are registry-owned, so they publish on the same shell stream and consumers mirror
them.

### 2.3 The firewall, enforced in schema

`mhotels-inspire/docs/29 §3` is enforced today as a data-flow rule and a console UI
choice ("shows past-due signal, not direct bill"). Make it a property of the permission
instead:

```
permission { key: "ar.view",     scopeMax: "property" }
permission { key: "folio.post",  scopeMax: "property" }
permission { key: "rate.author", scopeMax: "portfolio" }
```

A `scopeMax: property` permission **cannot be attached to a role granted at `group` or
`portfolio` scope** — this app refuses the write. The firewall stops being a discipline
and becomes a constraint violation.

Treat a group grant as above-property regardless of cardinality, even a one-property
group. Otherwise a single-member group is a bypass.

### 2.4 Role packs

Roles live in data, organized into packs. A property inherits its pack when the shell
commits, so assigning someone is: pick property (or group), pick role. Never forty
checkboxes.

Roles are **versioned and published, never edited in place** — editing "gm" silently
rewrites history for every GM and makes the audit trail lie. Operational roles float to
latest with a diffed, logged publish event; roles carrying `scopeMax: property` financial
permissions pin to a version and require explicit migration.

### 2.5 Lifecycle verbs

Nothing is deleted. Inspire's `UserPropertyRole` today is `@@id([userId, propertyId])`
with no temporal columns — no history, no transfer, and structurally one role per
property per user.

| Verb | Effect |
|---|---|
| **Onboard** | create `person` + first grant(s) |
| **Grant** | open a grant |
| **Transfer** | close old grant (`effectiveTo`), open new — one action, both sides |
| **Suspend** | freeze all grants, person row intact |
| **Offboard** | close all grants; person retained for audit |
| **Elevate** | time-boxed grant, mandatory reason, auto-expires, appears on a report |

Temporal grants make "who had access to EVVBC on 3 March" a query rather than an
investigation.

### 2.6 The missing middle tier

The second half of the regional problem, independent of scopes.

`roleAt()` returns `"admin"` at every property for `corporate_admin`, and `"readonly"`
everywhere for `corporate_viewer`. `MODULE_ACCESS.ar = ["admin","gm","auditor"]`, so:

- `corporate_viewer` — cannot see the A/R module anywhere. Genuinely read-only.
- `corporate_admin` — passes `canManageAr` at **every property**, because rank 100 ≥ gm's 80.

There is nothing in between. A Regional DOO must be given either too little to do the job
or A/R authority over every hotel in the portfolio. Adding `region` to the scope enum
would not have fixed this on its own — you would have had a correctly-scoped grant with
no appropriate role to put in it.

Under §2.3 this resolves cleanly: `corporate_admin` becomes a `portfolio`-scoped grant,
and A/R permissions cannot ride on it. Someone at corporate who genuinely needs A/R at a
property takes an explicit `property` grant or a time-boxed **Elevate** — the honest
expression of `docs/29 §3` anyway.

---

## 3. Sections

Inspire's `/corporate` today is coding, companies, gl, properties, requests — a
corporate-flavored PMS admin. This app has five sections instead:

1. **Portfolio** — the property registry. Code, brand, status, groups, lifecycle,
   provisioning health. New Property (the generator) lives here.
2. **Groups** — regions, brands, entities, ad-hoc. Membership editing, rule preview,
   "who does this change affect."
3. **People** — persons, grants, role catalog, lifecycle verbs, access review.
4. **Oversight** — §3.1.
5. **Standards** — brand table, market and submarket claims with their `marketSource`,
   blocked strings, role packs, permission catalog. MHG-IC stops being a document and
   becomes configuration with a change log.

Plus **Audit** — append-only, same shape as Inspire's and InspiredREV's `AuditLog`.

`corporate/coding` and `corporate/gl` are chart-of-accounts administration. Org-global
and genuinely corporate, but PMS configuration by the discipline test. They can move
here under Standards or Finance — as the acknowledged exception, not as something that
sets the tone.

### 3.1 Oversight is exception-first

Not a report dump — a list that should ideally be empty:

- `XT` placeholder flags on properties approaching go-live (B3, enforced live)
- provisioning failures, or consumers stuck behind current `shellVersion`
- properties whose directory row has a stale `syncedAt`
- persons with zero active grants; grants expiring in 30 days
- elevations active right now
- pipeline properties past expected-open with no status change
- roles whose published version diverges from what grants pin to
- `pastDue120` counts — the one permitted receivable-derived signal, at the permitted
  resolution

Performance thresholds belong here too, as exceptions against a threshold, not a wall of
charts.

---

## 4. Migration order

Data model before cosmetics, or the redesign is paint on the old nouns.

0. **`@mcx/inn-code` consumable.** Installed as a git dependency pinned to a tag, not
   published to a registry — GitHub Packages requires the npm scope to match the owning
   account (`@imazanka-mcx/*`), and renaming the scope or standing up an org is ceremony
   for one library with one consumer. In this app's `package.json`:

   ```json
   "@mcx/inn-code": "git+ssh://git@github.com/imazanka-mcx/mhg-icgenerator.git#v1.0.0"
   ```

   The generator has a `prepare` script, so `dist/` builds on install. Bump the tag there
   when the rule ladder changes; bump the ref here to adopt it. **Vercel needs a credential
   to clone a private git dependency** — a deploy key or a PAT in the build environment.
   That is the one setup cost of this route, and a private registry would have needed the
   same. (`mhg-icgenerator` initialized and tagged `v1.0.0` 2026-09-15.)
1. **`PrismaRegistry`** here, against the existing engine. Port the Firestore registry's
   semantics; the 70 tests carry over against the new adapter.
2. **Backfill codes.** Run the ladder over the current portfolio. M4/M5 cases need human
   adjudication once; persist `marketSource` and the trace on every row.
3. **New Property flow** here, replacing Inspire's free-text code field. `Property.code`
   stays as the column in Inspire; it now only ever receives an issued code.
4. **Groups + grants schema.** `PropertyGroup`, `PropertyGroupMember`, `grant`. Migrate
   Inspire's `UserPropertyRole` → `grant` at `property` scope; migrate InspiredREV's
   `AccessGrant` `brand` rows → `group` scope against rule-backed brand groups.
5. **Role catalog out of the enum**, into data, with packs and versions. Inspire's
   `RANK` and `MODULE_ACCESS` become seed data here. **The users who do not fit a
   template are the finding** — that list is the current access sprawl, and it is worth
   reading before finalizing the packs.
6. **Invert the directory sync** (§6). Highest-risk step; shadow it — populate mirrors
   and compare against live before cutover.
7. **Strip the PMS screens** from Inspire's `/corporate`.
8. **Subscribe InspiredREV to the shell stream**; retire its per-property `isk_`
   directory keys. Operational `isk_` keys — OpsCore's included — are untouched.

Steps 1–5 stand on their own. Steps 7–8 are worthless without them.

---

## 5. Open decisions

- Region *boundaries* — deliberately deferred. §2.2 exists so this can stay open
  indefinitely.
- Revocation lag target for financial roles (drives token TTL).
- Cross-app auth: whether Inspire and InspiredREV authenticate against a mirror of
  `person`/`grant` (R2 says yes) and what the refresh cadence is.
- Whether this app owns org structure (entities, ownership cos) or mirrors it.
- The BYX house name in `Organization.settings`, still parked by
  `mhotels-inspire/docs/18`.

---

## 6. Reconciling with `mhg-inspiredrev/docs/01 §5`

That doc says **"Property truth flows up, never down."** R1 says identity flows down.
Both are right, about different things, and the distinction belongs in writing rather
than left as a live contradiction between two specs.

### 6.1 Two kinds of truth

- **Operational truth** — rooms, room types, OOO/OOS, in-house, occupancy, pickup.
  Originates at the property because it *is* the property. Flows up. §5 stands entirely
  unchanged.
- **Identity** — that a property exists, what it is called, what code it carries, what
  brand is on the door. Originates at the **deal**, and flows down.

§5's own examples are all operational. The one line that changes is its characterization
of the directory row as "pointing at a property Inspire owns" — it should point at a
registry entry that Inspire also consumes.

### 6.2 Why the current direction cannot hold

G6 issues a code **at LOI or contract signature**, so pre-opening accounting, vendor
setup and the PIP file share one identifier from day one. But the directory row is
populated by calling that property's own Inspire instance with a key issued from its
Admin → Integrations page.

A pipeline property has no Inspire instance. So today a property cannot exist in
InspiredREV until its PMS is stood up — which means **no opening rates can be loaded
before the PMS exists**, and the whole point of G6 is lost. That is a structural break,
not a theoretical one, and it is the clearest argument for the inversion.

### 6.3 What survives untouched

Inspire's `GET /api/integration/v1/property` keeps working through the transition — it
just stops being the source. The `isk_` bearer pattern stays for operational up-flow
(attendants, rooms, task sheets) and for third-party integrations generally, which §1.6
leaves alone. EVALUATE still runs with central down. TRANSACT stays pinned to Inspire.
The firewall gets *stronger*, since §2.3 enforces in the permission engine what `docs/29`
enforces by convention.
