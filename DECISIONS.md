# Decisions

Every **[OPEN]** and **[ASSUMPTION]** from the spec, and anything decided during the build.
"Where" points to the single place to change it.

## Scope change: ocean export only

The spec covers ocean and air. **The product owner has narrowed the app to ocean export only**
(16-Oct-2026). Consequences:

- No `mode` field. Job No. is `EX-O-{YYMM}-{seq4}` and the house document is always an **HBL**
  (`NNRO{YY}{seq5}`). The fixed "O" lives in `src/lib/numbering.ts` (`JOB_PREFIX`, `HBL_PREFIX`), so
  air could be re-added later as a second prefix without renumbering existing ocean jobs.
- `hbl_hawb_no` becomes `hblNo`; `mawb_no` is dropped. `cargo_type` is `FCL | LCL`.
- **Arrastre still applies to every shipment.** Only the `NA` option (spec: "NA for AIR") is removed, so
  `arrastre_responsibility` is `NNR | SHIPPER`. The arrastre deadline and alerts apply when it is `NNR`.

## Spec [OPEN] items

| # | Item | Resolution for now | Where |
|---|---|---|---|
| O1 | What "FSI" means | Treated as **Final Shipping Instruction**. Only UI labels depend on it. | UI labels |
| O2 | How FSI completion is recorded | Dedicated `fsiSubmittedAt` field, set by a "Mark FSI submitted" button, plus an `FSI_SUBMITTED` milestone event. Same pattern for pre-advise (`preadviseSentAt`). | `prisma/schema.prisma` |
| O3 | BOC upload deadline rule | `fsiCutoffAt - 24h` (spec default), editable in `deadline_rules`. | `src/lib/deadlines.ts` `DEFAULT_RULES` |
| O4 | Arrastre deadline rule | `etdMnl - 24h`, only when arrastre = `NNR` (skipped when `SHIPPER`). Editable. | same |
| O5 | Extra notification channel | Telegram stub behind a `Notifier` interface (Step 4). | — |
| O6 | Mailbox reading / forwarding | Not built. CS pastes email text into `/intake` (Step 7). | — |

## Spec [ASSUMPTION] items

| # | Item | Implemented as | Where |
|---|---|---|---|
| A1 | HBL format | `NNRO{YY}{seq5}`, sequence per **year** (Manila calendar) | `src/lib/numbering.ts` |
| A2 | Export declaration statuses | `PENDING → FILED → ASSESSED → RELEASED` | `prisma/schema.prisma` enum |
| A3 | Default reminder/escalation timing | Reminders at -24h, -4h, -1h; overdue at due time then every 2h, max 3/day. Stored per rule. | `DEFAULT_RULES` |
| A4 | Stack | Next.js 15 (App Router) + Prisma 6 + SQLite + Tailwind 4 + zod + bcryptjs + Vitest | `package.json` |

## Step 1 decisions (schema, auth, seed)

1. **`requestedPickupAt` and `etdMnl` are nullable in the DB**, although the spec lists them as plain
   datetimes. Customer emails often lack them, so an intake must still be saveable. A shipment with no
   requested pick-up has status `BOOKED` (otherwise `BOOKED` could never occur). Missing values are
   reported under "Shipments with missing mandatory data" (daily report §6).
2. **The HBL No. is assigned when the shipment is created.** "Confirmation" = CS saving the manual form,
   or confirming the reviewed AI extraction. Nothing is saved before a human confirms, so there is no
   earlier draft state that would need a number.
3. **Job No. month uses the Manila calendar.** 23:30 UTC on 31 Oct is already November in Manila.
4. **Numbering is atomic via a counter table** (`NumberSequence`) using two portable SQL statements:
   `INSERT … ON CONFLICT DO NOTHING`, then `UPDATE … SET value = value + 1 … RETURNING value`. These
   work on SQLite ≥ 3.35 and Postgres. Call it first inside the transaction that creates the shipment,
   so a failed create also rolls back the number. A rolled-back number can be reused; a committed one never is.
5. **SQLite needs `?connection_limit=1`** in `DATABASE_URL`. Without it, concurrent Prisma interactive
   transactions on SQLite hit socket timeouts (found by the concurrency test). Remove it on Postgres.
6. **Status is derived from the furthest completed step**, not strictly the most recent one. A step
   confirmed out of order (e.g. BOC upload before pre-advise) still moves the status forward; skipped
   earlier steps still raise their own deadline alerts.
7. **`ARRIVED` = ATA recorded, or (departed and ETA has passed).** Added an `ata` field because the spec
   says "ETA reached / ATA". `CLOSED` is set by an explicit action (`closedAt`).
8. **Sessions are opaque random tokens stored hashed (SHA-256)** in a `Session` table, httpOnly cookie,
   7 days. No JWT, no auth library. Deactivating a user deletes their sessions immediately.
9. **Customer-readiness:** `Role.CUSTOMER` exists and `User.shipperId` links a customer login to a
   shipper. Login rejects `CUSTOMER` in the MVP. The seed creates 2 *inactive* customer users only to
   satisfy "2 users per role" and exercise the model. `Shipment.source` includes `CUSTOMER`.
10. **Computed deadlines are cached** on the shipment (`bocDeadlineAt`, `arrastreDeadlineAt`) for fast
    board/report queries; recomputed whenever a base field or rule changes (Step 4).
11. **Alert idempotency is enforced by a DB unique key** `(shipment, deadlineType, level, offsetMinutes,
    dueAt)`. `dueAt` is part of the key so that editing a cut-off produces a fresh alert series instead
    of silently suppressing it.
12. **Permissions:** monthly report is supervisor-only; daily report is CS + supervisor (CS receive it by
    email anyway). Whether CS see all shipments or only their assigned ones is decided in Step 3.
13. **Seeded arrastre payments have no proof attachment**, because file storage arrives with the upload
    feature. Real payments will require proof.
14. **`npm run setup` is non-destructive** (`migrate deploy` + seed; the seed skips a non-empty DB).
    Resetting means deleting `prisma/dev.db` on purpose.
15. **Simulated time (Step 4) will not affect session expiry**, so fast-forwarding the clock in a demo
    does not log people out. `src/lib/clock.ts` is the single `now()` the engine will use.

## Step 2 decisions (shipment form, milestones, status machine)

1. **One write path.** `src/lib/shipments.ts` is the only code that writes shipments. Each create, edit
   or milestone validates the change, recomputes status and the cached deadlines, and appends
   `milestone_events` in one transaction.
2. **The edit form only changes planning fields** (shipper, ports, cargo, cut-offs, ETD/ETA, carrier,
   arrastre, assigned CS). Milestone timestamps (pick-up done, FSI, pre-advise, BOC, arrastre, docs,
   ATD, ATA) change only through their own buttons, so each one is a deliberate, logged act. An edit
   writes one `FIELD_CHANGED` event listing old → new values, and nothing if nothing changed.
3. **Milestone time:** blank means "now". A past time can be entered (e.g. pick-up happened earlier),
   and up to 10 minutes in the future is tolerated for phone clock drift.
4. **A milestone cannot be recorded twice**; the second attempt is rejected with the original time.
   **[OPEN] Correcting a wrongly recorded milestone** (undo) is not built yet. Proposal: supervisor-only
   "revert" that logs a `REVERTED` event, never deleting the original.
5. **Steps may be confirmed out of order** (e.g. BOC upload before pre-advise). The status follows the
   furthest step (Step 1, decision 6).
6. **Export declaration status can move in any direction** (each change logged), because BOC can send a
   declaration back. The status counts as `DECLARED` once it is not `PENDING`.
7. **Arrastre payment requires a proof file** (PNG/JPG/WEBP/PDF, max 10 MB) and is only allowed when
   arrastre = NNR. Files are stored via `FileStorage` (local disk now) and served only to logged-in
   CS/supervisors at `/api/attachments/{id}` (no public URLs). If saving the milestone fails after the
   upload, the file stays as an unlinked attachment (kept for audit, not deleted).
8. **Export docs sent:** recipient defaults to the shipper's email and the subject to
   `Export docs {Job No.} / HBL {HBL No.}`. Both are stored, as the spec requires.
9. **Cancel** needs a reason and is only allowed before departure. **Close** is only allowed once arrived.
   Closed and cancelled shipments are read-only. Nothing is ever deleted.
10. **CS recording a field person's text message:** the pick-up and declaration steps have an "On behalf
    of field" option with a note. The event source is `CS_ON_BEHALF` (spec section 9 fallback).
11. **Validation:** FCL needs at least one container row, with each size listed once (2×40'HC + 1×40' is
    fine). LCL needs quantity and unit. ETA must be after ETD, and ATA after ATD. Fields for the other
    cargo type are dropped on save.
12. **Shipper master:** CS and supervisors can add shippers at `/shippers`. Editing shippers is not built
    yet. The form's shipper field only accepts an existing shipper (autocomplete) and fills in the
    shipper's default arrastre until CS changes it.
13. **"Missing mandatory data"** (`src/lib/mandatory.ts`): before departure, requested pick-up, ETD, carrier,
    carrier booking ref, FSI cut-off and pre-advise cut-off; after departure, ETA. Nothing on
    cancelled/closed shipments. Shown on the shipment page now and in the daily report later.
14. **Field users cannot open shipment pages.** They update through magic links (Step 5).
15. **Date pickers** (`<input type="datetime-local">`) show the browser's own date format (e.g. mm/dd),
    which the app cannot control. Everything the app displays uses `DD-MMM-YYYY HH:mm`, Manila time.
16. **HBL correction** (supervisor) rejects a number used by another shipment or retired by an earlier
    correction, and logs the reason.
