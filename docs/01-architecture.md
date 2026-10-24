# 01 — Corporate Console Architecture (MHG-CC v0.4)

**Status:** Phase 0 — settled, nothing built. Read this before writing any code in
this repo; it exists so the reasoning behind the registry plane, and the hard
constraints on what this app owns, don't have to be re-derived every session.

Depends on: MHG-IC v1.0 (Inn Code Standard) · `mhg-icgenerator` · `mhotels-inspire` ·
`mhg-inspiredrev`

> **v0.8 (2026-10-24):** §2.8 added and built — the people stream. One account across
> the console, Inspire and InspiredREV: the console pushes each person's password hash,
> status and translated access to both apps, which sign them in on their own. Property
> staff change passwords inside the apps; only corporate staff may use the console.
> **v0.7 (2026-10-24):** §2.7 added and built — the role crosswalk. Each console role
> names the one role it becomes in Inspire and in InspiredREV, checked against the
> firewall, as the first step toward one account across all three apps.
> **v0.6 (2026-10-24):** §1.7 added and built — ownership and control. Organizations
> (ownership groups, management companies) with principals, dated ownership and
> management assignments per property, the management rule as a gate on opening, and
> the console-only asset and compliance fields. Closes the §5 question of whether this
> app owns org structure: it does.
> **v0.5 (2026-10-03):** §1.4 built — the shell stream, both receivers, and the
> lifecycle as a rule. What building it settled is written up under §1.4.
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
| **The brand table narrowed to MHG flags only** — `BC` BYX Collection, `LX` BYX Luxury, chain `MHG`. Franchised houses under someone else's flag get no inn code. | `mhg-icgenerator/src/config/brands.ts` | Collapses the brand-model duplicate (§1.5). |
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
  "chainCode": "MHG",
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

#### What building it settled (2026-10-03)

Built: `src/shell/` here, `src/lib/registry/` plus `POST /api/registry/v1/shell` in
both consumers, the `registry_property` mirror in Inspire, registry columns on
InspiredREV's directory, `npm run shell`, a property page with lifecycle and
provisioning, and a daily cron. Ten things the paragraph above had not decided:

- **The outbox holds change notices, not payloads.** A `shell_event` row says
  "property X changed, now at version N"; the shell is built from current state at
  delivery. Replay-from-zero then converges on the *current* shell for every
  property rather than walking consumers through stale ones, three edits to one
  hotel deliver once (`coalesce()`), and a payload can never disagree with the row
  it describes. What is lost is a history of past shells — and that history already
  exists, in `inn_code` and `audit_event`, where it belongs.

- **One push, a cursor, and an ack — not a webhook per event and not a pull.** The
  console POSTs everything past a subscriber's `cursor`; the consumer applies in
  order and answers `appliedThrough`; the cursor moves to exactly that. A consumer
  that was down is simply behind, and the next push from its cursor catches it up.
  Pull was rejected because it puts a scheduler in every consumer; per-event
  webhooks because they need a retry queue per event to get what a cursor gives
  for free.

- **Idempotency is the consumer's job, by `shellVersion`.** Each property's version
  is bumped in the same transaction as its notice. A consumer applies a shell only
  if it is newer than what it holds, so redelivery, a crashed ack, and a full
  rewind are all harmless. That is what made "replayable from zero" cheap.

- **Delivery never fails the change that caused it** (R2 seen from this side). Every
  registry write notes the change and then tries to deliver on the spot, quietly. A
  failure lands in `shell_subscriber.last_error` and on the property page as
  *behind*; the property page's **Deliver now**, `npm run shell -- deliver`, and the
  daily cron (`/api/shell/cron` — Hobby allows one a day) all resume from the cursor.

- **Group membership notes, it does not deliver.** Groups are in the shell, so
  membership changes are notices too — but a rule sync after issuance would
  otherwise deliver twice. `groups.ts` only notes; callers deliver.

- **Auth is an HMAC over a timestamped body, one secret per subscriber.**
  `x-mhg-registry-signature: t=…,v1=…`, five-minute tolerance, the timestamp inside
  the MAC. Not the `isk_` bearer pattern: that authenticates a caller *into* Inspire
  for one property, and this is the registry speaking for the whole portfolio. The
  secret is stored plaintext here because every delivery is signed with it — the
  same tradeoff Inspire makes for `WebhookEndpoint.secret`.

- **The contract is copied, not published.** `src/shell/contract.ts` is canonical,
  dependency-free and erasable TypeScript, and both consumers carry it verbatim at
  `src/lib/registry/contract.ts`. `test/contract-copies.test.ts` fails here if a copy
  drifts, whenever the sibling repos sit alongside this one. A consumer refuses a
  contract number it does not know, so a half-rolled change fails loudly rather
  than half-applying.

- **Timezone, currency and expected opening ride on the property here**, not in the
  engine — the engine derives codes from name, place and flag, and these change
  none of that. They are validated *before* the claim (`src/setup.ts`), because a
  bad timezone must not be discovered after the code is burned.

- **Consumers adopt by code, once.** The first shell for a property links the
  consumer's existing unlinked row flying that code (or its predecessor). That is
  how hotels built before the stream join it without a migration. From then on the
  link is the registry id and the code is just a label that can change (G1).

- **Inspire applies identity to a live hotel, not its clock or its money.** Code,
  name and brand relabel a stood-up property. Timezone and currency are stamped at
  stand-up and never synced afterwards: on a trading hotel the first moves the
  business-date boundary and the second re-denominates folios. A difference shows on
  Inspire's corporate page as drift; changing it is a deliberate migration there.
  InspiredREV has no folios and takes the timezone.

#### The lifecycle, as built

`src/lifecycle.ts` makes the status a rule: **pipeline → active** (open),
**pipeline → retired** (the deal died), **active → retired** (exit). Forward only;
retired is terminal because a retired code is never reissued (G3) and reviving one
would make a code mean two tenancies of a building. A flag change is `rebrand`, not
a status. Every move is audited with a reason and published.

| Stage | Console | Inspire | InspiredREV |
|---|---|---|---|
| Claim (LOI, G6) | code + market claimed, `pipeline`, published | mirror row; **Stand up** offered on `/corporate` | directory row created, no Inspire key needed |
| Stand-up | — | `/corporate/properties/new?registry=…` builds the Property with the registry's code, name, brand, clock and money, linked by id | — |
| Open | `active`, published | mirror status updates | `registry_status` updates |
| Rebrand | new code, old retired, same id, published | live Property relabelled in place | directory row relabelled in place |
| Exit | `retired`, terminal, published | mirror shows retired; nothing deleted | `registry_status` = retired |

### 1.5 One brand table

`@mcx/inn-code`'s `BrandEntry` (`BC`/`LX`, chain `MHG`) and Inspire's `Brand` model
(`BrandTier`, `endorsement`, the "[Name] by [House]" convention, placeholder code
`FLAG`) are the same concept modeled twice. Now that the IC table is MHG-flags-only,
there is no tension to resolve — just a duplicate.

This app owns it. Inspire's `Brand` rows become a mirror, and `Brand.code` should be
`BC`/`LX`. The house name that `mhotels-inspire/docs/18` parks in
`Organization.settings` "once decided" appears to be BYX; worth closing out in the same
pass.

**Served, 2026-10-03.** `GET /api/registry/v1/brands` returns `MHG_BRANDS` (retired
flags included and marked) to any active shell subscriber that names itself in
`x-mhg-registry-subscriber` and signs `brands:<name>` with its shell secret.
InspiredREV mirrors it on every /admin load; Inspire can adopt it the same way when
its `Brand` rows move to `BC`/`LX`. Read-only, and it never moves a stream cursor.

**Chain code MAZ → MHG, 2026-10-24.** `@mcx/inn-code` v1.2.0 files both flags under
chain `MHG`. The chain is not part of the inn code, so nothing is reissued; migration
`20261024210000_chain_code_mhg` relabels `property`, the `inn_code` ledger and any
rule group sliced by chain, and bumps each property's shell with reason `backfill` so
both subscribers pick up `MHG` on the next delivery. InspiredREV's brand mirror
follows on its next pull.

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

### 1.7 Ownership and control

Who owns the building and who runs it. This passes the discipline test in §1.1 — it
changes what the portfolio does, not how one guest's stay goes — and it was the open
question in §5 of whether this app owns org structure or mirrors it. **It owns it.**
There is nothing upstream to mirror: no other MHG system records who owns a hotel.

**The rule.** Every MHG hotel is run by a **registered third-party management company**.
It may not be operated by a principal of its ownership group. Opening a hotel
(`pipeline → active`) is refused until that holds. Abandon and exit are never gated.

**The shape.**

- `organization` — one row per ownership group or management company, however many
  hotels it holds. `kind` is `ownership | management` and is fixed at creation: an
  owner that became a manager would silently change what every assignment on it
  means. The id is a slug minted once (`org_riverside_capital`), same discipline as a
  group id. A management company must carry `registeredState` and
  `registrationNumber` — that is what "registered third party" means in data.
- `organization_principal` — the people who own or control an organization, compared
  across organizations on **lowercased email**. Deliberately not `person`: principals
  are not console users, and putting them in `person` would put logins where only
  names belong. Removed principals keep their row (`removedAt`) so past compliance can
  be explained.
- `property_ownership` and `property_management` — **dated assignments**, the same
  temporal shape as a grant (§2.5). One live row per property (`effectiveTo` null).
  Assigning a new owner or manager closes the live row on the new row's start date, in
  one transaction. A sale is a new row, never an edit, so "who managed EVVHX on 3 March"
  is a query. Ownership carries the **title-holding entity** (the single-asset LLC on
  the deed, which is usually not the group) and the **MHG licence** term. Management
  carries the **management agreement** expiry and termination notice, because the
  agreement and the assignment begin and end together.

**Where the rule is enforced** — `src/orgs/rules.ts` (pure, unit-tested) decides;
`src/orgs/orgs.ts` refuses:

1. **Assigning a manager** is checked against the live owner, so ownership comes first.
2. **Assigning a new owner** re-checks the live manager — a sale to the manager's own
   principals must not slip in through the ownership door.
3. **Adding a principal** re-checks every live pairing that organization is part of.
4. **Archiving** an organization that still holds an assignment is refused.
5. **Ending** an assignment with no successor is refused on an active hotel: an active
   MHG hotel always has an owner and a registered manager, so the only way to change
   either is to assign the next one.
6. **Opening** — `changeStatus` calls `assertReadyToOpen` on the `open` transition, so
   the property page and `npm run issue -- status` share one gate.

Blocks are the rule (no owner, no manager, manager unregistered or archived, owner
managing itself, a shared principal by email). Warnings are what data cannot settle —
the same name on both sides under different emails, a missing address or key count —
and show on the page without refusing anything. A rule with no principals recorded
passes and proves nothing; the Organizations section says so where it lists them.

**The asset**, on `property`: street address, postal code, **key count**, service level,
year opened and last renovated, and the brand compliance fields Oversight will read
(PIP status and due date, last QA date and result). Room types, inventory and
meeting space stay in Inspire.

**Not in the shell.** None of this bumps `shellVersion` or publishes; every write is
audited. Adding a field to the shell is cheaper than taking one out, so ownership and
management flow down (R1) only when a consumer asks for them.

**Left out on purpose.** Fees, P&L, lender and loan terms, and tax ids. They would make
the console a more sensitive system than it needs to be; a lender, if ever wanted, is a
name. **Key people** (GM, DOS, DOF) are not built — see §5.

**Permissions.** `org.read` (owner, registrar, viewer) and `org.manage` (owner,
registrar). Assigning ownership and management takes `org.manage`, not
`property.issue`, because it decides whether a hotel may open. The asset fields take
`property.issue`, like the stand-up details.

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

#### What building it settled (2026-09-15)

Nine things the spec above had not decided, listed with the reasoning rather than just the
conclusion, because the conclusions are cheap and the reasoning is what stops them being
undone.

- **Membership is keyed on the property's immutable id, and resolution reads the current
  code through it.** The spec wrote `PropertyGroupMember { groupId, propertyId }` without
  saying which property key that was, and the choice is load-bearing: keyed on the inn
  code, a rebrand would silently drop a hotel out of its region. Keyed on the id, group
  coverage survives a code change for free — the same reason downstream systems hold the
  id and never the code (G1, G2).

- **`covers()` takes the target's group set as an argument.** Deciding whether a group
  grant reaches a property needs one fact that scope arithmetic cannot derive: which
  groups that property is in. Passing it in keeps `auth/scope.ts` free of Prisma, so every
  coverage case stays a unit test rather than a fixture. `permissionsAt` does the lookup,
  and skips it entirely unless the target is a property *and* the person actually holds a
  group grant — so the common path is still one query.

- **Grants and membership speak different property vocabularies, and that seam is now
  explicit.** A grant at property scope holds an inn *code*; membership holds the internal
  *id*. `resolveProperty` accepts either and `grantAccess` normalizes what it stores. See
  §5 — whether property grants should move to ids is now an open decision rather than an
  accident.

- **Rule groups materialize into rows; they are not evaluated on read.** A live predicate
  is not inspectable — "who is in Midwest" would have no answer that survives being asked
  twice, and access resolution would have two shapes depending on how a property got in.
  The cost is that rows can go stale, so `synced_at` exists to make that visible, issuing
  or rebranding a code re-materializes every rule group, and drift is an Oversight
  exception (§3.1) with a check of its own in `npm run verify:groups`.

- **A rule with no conditions is refused.** It matches the whole portfolio, which is
  portfolio scope wearing a group's name — and it would arrive silently, as a group that
  mysteriously contains everything.

- **A rule that does not mention status excludes retired codes.** One implicit condition,
  stated in the UI and in `describeRule`, because a region that quietly accumulates dead
  hotels stops being a list of places anyone operates. `status: ['retired']` means it.

- **Archiving a group does not stop it resolving.** Access is closed by closing a grant.
  A group that stopped covering its members when archived would revoke people through what
  looks like a display action.

- **Groups do not nest.** A property is in many groups, flat. Nesting would reintroduce the
  single-parent hierarchy this section exists to avoid, and would turn "how wide is this
  grant" from a lookup into a graph walk.

- **`group.read` / `group.manage` are their own permissions, split from `people.manage`.**
  Editing membership *is* an access change — it widens everyone holding a grant on that
  group, without touching a grant — but drawing regions and provisioning people are
  different jobs, and a registrar should be able to do the first without the second. Both
  are portfolio-capped: there is no managing groups from inside one group. The group page
  answers "who does this change affect" by listing the live grants held on it, and
  `grantAccess` now refuses a grant whose `scope_ref` points at no group and no property —
  a grant pointing at nothing looks like access on the People page and confers none.

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


### 2.7 The role crosswalk

One person should sign in to Inspire and InspiredREV with the same account, provisioned
once, here. That needs one fact the grant model did not hold: what a console role
*becomes* in each app. A grant says "gm at ALQBC"; Inspire needs a `user_property_role`
of `gm`, and InspiredREV needs a `readonly` user with a property-scope `access_grant`.
The crosswalk is that translation, as data. Built 2026-10-24.

**The shape.**

- `consumer_role` — a mirror of the roles each consumer enforces in its own code:
  Inspire's `Role` and `OrgRole` enums, InspiredREV's `Role` enum. Not a design — when a
  consumer changes a role, the mirror follows in the same change. Each row has a `tier`
  (`org` for Inspire's corporate roles, held org-wide; `property` for everything else)
  and `carries`: the console permission keys it implies downstream.
- `role_link` — one row per consumer role a console role may become, exactly one of
  them the default. **No rows means no access in that app.** A link is part of a role's
  meaning, so changing one bumps the role's version exactly like changing its
  permissions (§2.4).
- `grant_downstream` — what each grant became in each consumer, fixed when it was
  issued. Where a link offers a choice — a GM is `readonly` in InspiredREV unless
  `revenue_manager` is chosen — the People form asks, and `grantAccess` refuses anything
  the link does not allow. Written for every consumer the role reaches, default or not,
  so the people stream reads it rather than re-deriving it. Changing it is a transfer.

Both are seeded from `src/auth/catalog.ts` (`RoleSeed.links`) and
`src/auth/consumer-roles.ts` by `npm run db:seed`, which validates first and writes
nothing if a rule fails.

**The rule that makes it safe: a console role holds what its link carries.** Inspire's
`gm` manages A/R and posts to folios, so it carries `ar.view`, `ar.manage` and
`folio.post`. A console role may link to it only if it holds those same three — and
since they are capped at `property`, that role is property-only. The firewall (§2.3)
now governs the link, not just the console role: nothing can turn a group or portfolio
grant into A/R authority at a hotel by way of the crosswalk. The other rules:

1. A link names roles that exist in that consumer. Every allowed role is checked, not
   just the default — a choice must not be a way around the firewall.
2. An `org`-tier role is reachable only from a console role assignable at portfolio and
   nowhere narrower. A property grant never becomes corporate authority.
3. An **exception** may be declared on a link that breaks the carries rule, with its
   reason. Every seed prints it, and a stale exception — one no longer needed — is an
   error, so none outlive their reason.

**The crosswalk as shipped.**

| Console role | Scopes | Inspire | InspiredREV |
|---|---|---|---|
| owner | portfolio | corporate_admin ⚠ | admin |
| registrar | portfolio | corporate_viewer | readonly |
| viewer | portfolio, group, property | readonly | readonly |
| property_admin | property | admin | readonly |
| property_owner | property | gm | readonly *or* revenue_manager |
| director_of_sales | property | sales | sales *or* revenue_manager |
| gm | property | gm | revenue_manager *(or readonly)* |
| front_desk | property | front_desk | — |
| housekeeping | property | housekeeping | — |
| auditor | property | auditor | auditor |
| revenue_manager | portfolio, group, property | readonly | revenue_manager |
| sales | portfolio, group, property | readonly | sales |

⚠ The one exception. `corporate_admin` is admin at every hotel, A/R included — the §2.6
problem — and it is the only Inspire role that can stand up a property. Owner holds no
A/R, so the link breaks the rule on purpose. It retires when Inspire takes its roles
from grants (§4 step 5).

**Ownership is not corporate.** A principal of a hotel's ownership group gets
`property_owner` at that hotel: GM-level in Inspire, never `corporate_admin`, and the
same InspiredREV choice as a GM. Console `owner` is a different thing — it owns the
*registry* (the sunrise account) and is the only role linked to `corporate_admin`.

**What building it settled.**

- **Inspire's `revenue_manager` posts to folios.** Its rank (70) clears `front_desk`
  (60), and folio posting is gated `front_desk`+. So it carries `folio.post` and cannot
  ride a wider grant. A console `revenue_manager` — who works across hotels — is
  `readonly` in Inspire and authors in InspiredREV, where rates actually live. The rank
  ladder is the bug; this is the containment.
- **The property-operations roles carry only their downstream permissions.** `gm`,
  `front_desk` and the rest hold no console permission beyond what their Inspire role
  carries. They exist here so a person is provisioned once, not so they work in the
  console.
- **InspiredREV holds one role per user.** Several grants that link to different
  InspiredREV roles must collapse to one — the highest-ranked, with the grants' scopes
  unioned into `access_grant`. That is the people stream's job, not this table's; `rank`
  is here so it can.
- **Inspire gained a `sales` role and reshaped `auditor` (2026-10-24).** Inspire's
  `sales` ranks with `gm` and carries the same A/R and posting authority, without Room
  Types or Property Settings. It is mirrored but unlinked: the console `sales` role rides
  group and portfolio grants, so it stays `readonly` in Inspire. Inspire's `auditor` now
  ranks with `front_desk` and posts to folios, so the console `auditor` holds
  `folio.post` beside `ar.view` — still property-only.
- **Granting a property-operations role does nothing downstream yet.** The crosswalk is
  the translation; the people stream that delivers person, password hash, status and
  translated grants to each consumer is the next build.


### 2.8 The people stream — one account everywhere

The crosswalk (§2.7) says what a grant becomes downstream; this is how it gets there.
Built 2026-10-24. A person is provisioned once, on People, and signs in to Inspire and
InspiredREV with the same email and password.

**The shape.** The shell stream's twin (§1.4), on the same subscriptions and secrets:

- `person.person_version` and `person_event` — the same outbox discipline: a notice, not
  a payload. The person is built from current state at delivery, so a replay converges
  and a burst of grants delivers once.
- `shell_subscriber.people_cursor` (+ `people_last_*`) — each consumer's position in the
  people stream. Delivered to `/api/registry/v1/people`, beside the shell receiver.
- The payload (`Person` in `src/shell/contract.ts`, copied verbatim to both consumers):
  email, name, status, bcrypt hash, version, and **this consumer's grants only**, already
  translated — `{ scope, ref, role }` with `ref` a group id or a registry propertyId,
  never an inn code. Plaintext passwords never travel; the contract refuses anything that
  is not a bcrypt hash.

**When it fires.** `grantAccess`, `revokeGrant`, a password change here or downstream.
Each publishes on the spot and never fails the change that caused it; the daily cron
catches up both streams in one pass. `npm run people -- backfill --confirm` puts existing
people in.

**What the consumers do with it.**

- They upsert an `AppUser` linked by `registry_person_id`. The first delivery of an email
  that already exists locally **takes that row over** — same id, same history. Accounts
  the console never delivers keep working as local accounts, shown separately.
- A person signs in only when `active`, with a password, and with some access in that
  app. Suspended, offboarded, or with every grant closed: row kept, sign-in refused.
- WHERE is resolved **at sign-in** against the registry mirror (`portfolio` = every
  property, `group` = properties whose shell lists it, `property` = that propertyId). A
  hotel stood up or regrouped since the last delivery is covered without another one.
- Access for a console-managed person is read-only in the app: Inspire's Users & Roles,
  appointments and InspiredREV's grant forms refuse it, and list such people under
  "Managed by Maz Hotels Group".

**Passwords live here; property staff never come here.** A person changes their password
in Inspire or InspiredREV under Account. The app checks the current password against its
own copy, hashes the new one, and POSTs the hash — signed with its subscription secret —
to `/api/registry/v1/people/password`. Only once the console accepts it does the app
change its own copy, and the stream carries it to the other app. A consumer may only
change the password of someone it gives access to. This is the one path that needs the
console up; signing in never does (R2).

**Only corporate staff use the console.** A person whose live grants all are
property-operations roles (§2.7) is refused at console sign-in — after the password
check, with a message that points them to Inspire and InspiredREV — and `currentActor`
re-checks every request, so closing someone's last corporate grant removes them on the
next click.

**What building it settled.**

- **InspiredREV holds one role per user.** Mixed roles collapse to the strongest, scoped
  only to the grants that carry it. Collapsing the other way would give revenue-manager
  authority where only read-only was granted. The weaker grants are set aside and the
  ack says so. Per-property roles in InspiredREV would remove the compromise.
- **Inspire and InspiredREV compute access at sign-in, into a 12-hour session.** A
  revoked grant or a suspension takes effect at the person's next sign-in, not
  mid-shift. That is the open "revocation lag" decision in §5, now concrete.
- **InspiredREV did not keep group membership.** Properties now carry
  `registry_groups` from their shell; it fills on each property's next shell, so a
  shell backfill is part of going live.
- **Inspire's `sales` no longer edits Rev.** It ranks with `gm`, but rates are authored
  in InspiredREV, so `canEditRev` leaves it read-only there.

---

## 3. Sections

Inspire's `/corporate` today is coding, companies, gl, properties, requests — a
corporate-flavored PMS admin. This app has five sections instead:

1. **Portfolio** — the property registry. Code, brand, status, groups, lifecycle,
   provisioning health. New Property (the generator) lives here.
2. **Groups** — regions, brands, entities, ad-hoc. Membership editing, rule preview,
   "who does this change affect."
   **Organizations** (§1.7) — ownership groups and management companies, their
   principals, and the hotels each holds. Built 2026-10-24 as its own nav entry.
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
- active properties whose owner–manager pairing now fails the management rule (§1.7)
- MHG licences and management agreements expiring within 12 months; PIPs past due;
  failed brand QA
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
   "@mcx/inn-code": "git+ssh://git@github.com/imazanka-mcx/mhg-icgenerator.git#v1.1.0"
   ```

   The generator has a `prepare` script, so `dist/` builds on install. Bump the tag there
   when the rule ladder changes; bump the ref here to adopt it. **Vercel needs a credential
   to clone a private git dependency** — that is the one setup cost of this route, and a
   private registry would have needed the same. Settled 2026-09-16: a fine-grained,
   read-only PAT scoped to `mhg-icgenerator`, held in the build environment as
   `INN_CODE_TOKEN`, with `scripts/vercel-install.sh` rewriting the ssh:// URL to HTTPS for
   the length of the build. The credential stays out of `package.json`, so rotating it is
   not a commit. `DEPLOY.md §3`. (`mhg-icgenerator` initialized 2026-09-15; `v1.1.0` adds the claim helpers the port needs — §4 step 1.)
1. **`PrismaRegistry`** — **done 2026-09-15.** `prisma/schema.prisma`, `src/registry/prisma.ts`,
   `test/prisma-registry.test.ts`, and a constraint proof in `prisma/verify/`. Four things the
   implementation forced that this spec had not anticipated:

   - **The Registry port was incomplete.** `conflicts()` and `ownsSubmarket()` decide M7 and M6 and
     every adapter needs them, but they were internal to the Firestore implementation. Exported in
     `@mcx/inn-code` v1.1.0, which is why step 0 now pins that tag.
   - **Firestore's four collections become three tables.** `submarketIndex` existed only because
     Firestore cannot query on a field; here it is a nullable unique column,
     `market_claim.submarket_key`. Nulls do not collide in a Postgres unique index, which is
     exactly M6's rule — a base market code binds no submarket, a split owns its own.
   - **`inn_code` is the ledger, `property` is the hotel.** A rebrand upserts the property (keeping
     its id, G1) and *adds* an `inn_code` row; it replaces none. That is what makes G3 and M5 fire
     against history rather than against the live portfolio.
   - **The read-then-write checks do not provide the guarantee.** Under concurrency they lose, so
     every write path also translates Prisma's `P2002` into `ConflictError` — which `issueCode`
     already retries. `prisma/verify/constraints.sh` proves this against a real server, including
     two genuinely concurrent writers racing for one code: exactly one wins, and the loser is
     refused by the primary key. The harness applies the newest
     `prisma/migrations/*/migration.sql` rather than a hand-written copy of the schema, so it
     always tests the shape Prisma actually creates, and it refuses to run against anything
     but a local `*_test`/`*_dev` database.

   Tests use Node's built-in runner (`node --test`) rather than vitest, deliberately: the suite then
   needs no test dependency at all and runs under Node's type stripping. It is a divergence from
   `mhg-icgenerator`, which uses vitest.
2. **Backfill codes.** Run the ladder over the current portfolio. M4/M5 cases need human
   adjudication once; persist `marketSource` and the trace on every row.

   **Tooling done 2026-09-15** — `src/issuance.ts` binds the engine to `PrismaRegistry`, and
   `scripts/issue.ts` drives it: `npm run issue -- propose …` shows a code and the rules that
   produced it while writing nothing, and `issue`/`rebrand` refuse to run without `--confirm`,
   because a claim is permanent (G3, M7) and there is no undo. Use `propose` to review the
   ladder's output on the real portfolio before anything becomes permanent.

   Note the portfolio itself lives in Inspire's database — there are no property seeds in that
   repo — so how many rows this step actually has is an open question worth answering before
   building anything more elaborate than the CLI.

3. **New Property flow** here, replacing Inspire's free-text code field. `Property.code`
   stays as the column in Inspire; it now only ever receives an issued code.

   **Inspire's side, 2026-10-03.** Inspire's Add Property form now sends MHG flags to
   the registry: a registry code arrives on `/corporate` with **Stand up**, which fills
   identity from the shell and is not typed; the free-text form remains only for houses
   outside the MHG flags, and refuses any code the registry has issued.

4. **Grants schema — PARTLY DONE 2026-09-15.** `person`, `role`, `permission`, `grant` and
   `audit_event` are built, with temporal grants and polymorphic scope. `npm run sunrise`
   creates the first account and refuses once any person exists; from People, that account
   provisions everyone else and can grant `owner`, so admin rights propagate without a second
   bootstrap path. Verified end to end: migrate → seed → sunrise → sign in → create users.

   Three things the implementation settled:

   - **The firewall is enforced at grant time.** `permission.scopeMax` caps `ar.view`,
     `ar.manage` and `folio.post` at `property`, and `grantAccess` refuses any role carrying
     them at wider scope. A one-property group still counts as above property — cardinality is
     not the test, being a set is, and that bypass has a test of its own.
   - **The session guard is a layout, not middleware.** Middleware runs without a database, so
     it can confirm a token parses but not whether the person is still active or still holds
     anything. Resolving grants per request is the difference between revoking access and
     waiting out a token.
   - **Request-bound code is separated from the rules.** `auth/actor.ts` reads the session;
     `auth/access.ts` does not, because anything reaching `next/headers` cannot be loaded by a
     CLI. `test/cli-imports.test.ts` walks the import graph and fails on any bundler-only
     specifier, after this broke sunrise once.

   **`PropertyGroup` and `PropertyGroupMember` — done 2026-09-15.** §2.2 is built: the tables,
   a rule engine, the Groups section, a CLI, and group-aware grant resolution. What the
   implementation forced is written up in §2.2 under *What building it settled*.

5. **Role catalog out of the enum** — done for the console, open for Inspire. The catalog and
   its versioning live here now (`src/auth/catalog.ts`, seeded by `npm run db:seed`), and the
   A/R permissions are seeded capped so Inspire inherits the cap when it migrates. What remains
   is the migration itself: Inspire's `Role` enum, `RANK` and `MODULE_ACCESS` become rows here,
   and its `UserPropertyRole` rows become `grant`s at `property` scope. **The users who do not
   fit a template are the finding** — that list is the current access sprawl, and it is worth
   reading before finalizing the packs.

6. **Invert the directory sync** (§6). Highest-risk step; shadow it — populate mirrors
   and compare against live before cutover.

   **Built 2026-10-03, shadow by construction.** The stream (§1.4) populates Inspire's
   `registry_property` mirror and InspiredREV's directory. Nothing that worked stops
   working: Inspire's `GET /api/integration/v1/property` still answers, InspiredREV's
   pull still runs, and a consumer row only becomes registry-owned when a shell adopts
   it. The comparison §6 asked for is on Inspire's `/corporate` page (drift column) and
   in each consumer's `audit_log` (`registry_link` / `registry_sync` rows record every
   before/after).
7. **Strip the PMS screens** from Inspire's `/corporate`.
8. **Subscribe InspiredREV to the shell stream**; retire its per-property `isk_`
   directory keys. Operational `isk_` keys — OpsCore's included — are untouched.

   **Subscribed 2026-10-03.** For a registry-linked row the `isk_` pull now writes only
   `synced_at` — it proves the key works, which operational up-flow will need, and no
   longer writes identity. Retiring the keys outright waits for the up-flow they will
   carry.

Steps 1–5 stand on their own. Steps 7–8 are worthless without them.

---

## 5. Open decisions

- **What changes a live Inspire hotel's timezone or currency.** The shell carries both,
  and Inspire deliberately stamps them only at stand-up (§1.4). A real correction on a
  trading hotel is a migration with a business-date plan, and nobody has needed one yet.
- **Whether `expectedOpenDate` should gate anything** — today it only drives the
  "past expected opening" banner on the property page and Inspire's default business
  date at stand-up.
- Region *boundaries* — deliberately deferred. §2.2 exists so this can stay open
  indefinitely, and as of 2026-09-15 drawing one is an afternoon in the Groups section.
- **Whether a property-scope grant should hold the inn code or the internal property id.**
  It holds the code today, which is what the People form asks for and what a human can
  check — but a rebrand changes the code, and a grant on the old one then points at a
  retired code. Membership already sidesteps this by keying on the id. The options are: move
  `grant.scope_ref` to ids and render the code for display; keep codes and repoint grants on
  rebrand (a write, and the audit trail has to say so); or keep codes and accept that a
  rebrand needs a transfer. Nothing forces the decision until the first rebrand of a hotel
  somebody holds a property grant on.
- Revocation lag target for financial roles (drives token TTL).
- ~~Cross-app auth.~~ Settled and built — §2.7, §2.8, 2026-10-24: a mirror, as R2 said.
- Revocation lag: consumers resolve access into a 12-hour session at sign-in (§2.8).
  Whether financial roles need a shorter session, or a per-request status check, is open.
- ~~Whether this app owns org structure (entities, ownership cos) or mirrors it.~~
  Owns it — §1.7, 2026-10-24.
- **Key people at a property** (GM, DOS, DOF, owner's rep). As grants they would mean
  console or downstream access, which a GM title does not imply; as contact rows they
  duplicate People. Decide which before building either.
- **Whether ownership and management flow down in the shell** (R1). Console-only for
  now (§1.7); revisit when a consumer asks.
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
