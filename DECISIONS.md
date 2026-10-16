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

## Step 3 decisions (live board)

1. **CS see only their own shipments** (assigned to them, or created by them). Supervisors see all, per
   spec section 4 ("supervisor … view all shipments"). This applies everywhere: board, shipment page,
   edit, milestone actions, and proof downloads. Another CS's shipment returns 404, so ids don't reveal
   that a shipment exists. One rule in `src/lib/access.ts`; change it there if CS should cover each other.
2. **Board column order is an [ASSUMPTION]** until the current spreadsheet's headers are confirmed. It is
   one array in `src/app/board-columns.tsx` (Job No., HBL No., Shipper, Destination, POD, Cargo,
   Carrier, Booking ref, Pick-up, FSI, Pre-advise, Export decl., BOC upload, Arrastre, Docs sent,
   ETD, ATD, ETA, Status, CS, Remarks). The Excel "raw data" sheet (Step 6) will reuse it.
3. **Row colour** = worst open deadline across the five tracked deadlines (`src/lib/deadline-status.ts`):
   red if any is overdue, amber if any is due within 4h, else green. Deadline cells are coloured
   individually and show ✓ + time once done. Closed/cancelled rows are grey.
4. **After departure (ATD), open pre-departure deadlines stop turning red.** A missed FSI or BOC step
   on a shipment that has already sailed is history, not an action item. It still shows in the monthly
   missed-deadline metrics (Step 6). The same rule applies on the shipment page and, in Step 4, to alerts.
5. **Default view = active shipments** (everything except closed and cancelled). The quick-filter chips are
   Overdue, Due within 4h, Missing data, and All incl. closed. Chip counts respect the other filters.
6. **Default sort:** most urgent first (red, amber, green), then ETD ascending (unknown ETD last), then
   newest Job No. Column-header sorting is not built.
7. **Filters live in the URL** (bookmarkable). Invalid values are ignored, not errors. The date range
   filters on **ETD MNL**, with both ends inclusive and Manila days. The spec's "mode" filter is dropped
   (ocean only), and the CS filter is shown only to supervisors.
8. **"Live" = auto-refresh every 60 s** while the tab is visible. No websockets.
9. **Deadline-state and missing-data filters are computed in memory** after the database query. Fine for
   hundreds of active shipments; move into SQL if volumes grow to many thousands.
10. **The shipment detail timeline** (all `milestone_events`, newest first, with actor, source and note)
    was built in Step 2. Step 3 adds nothing to it.

## Step 4 decisions (deadline alerts, scheduler, notifications, simulate-time)

1. **One alert per slot, latest slot only.** For each open deadline, the engine works out the single slot
   that applies now: the nearest reminder already reached (−24h, −4h, −1h), DUE at the due time, or OVERDUE
   at +2h, +4h, … If the scheduler was down or the clock jumped, it sends one up-to-date alert, not a
   burst of stale ones (`currentSlot` in `src/lib/alerts.ts`).
2. **Idempotency:** a database unique key on (shipment, deadline, level, offset, due time) means an alert
   is created once, however many ticks run. Delivery is **claimed** (`sentAt` flipped from null)
   before sending, so two scheduler processes never send the same alert twice (tested with two
   concurrent ticks). `dueAt` is in the key, so moving a cut-off starts a fresh series and the old open
   alerts are closed as `SUPERSEDED`.
3. **Escalation:** "at due time, then every 2h while overdue (max 3 repeats/day)" means DUE at +0 (CS only),
   then OVERDUE at +2h, +4h, +6h (CS + all active supervisors). The cap of 3 OVERDUE per **Manila
   calendar day** resets at midnight. If the assigned CS is deactivated, every level goes to supervisors.
4. **Alerts close only when the step is done** (`COMPLETED`), when the deadline moves (`SUPERSEDED`), or
   when the shipment departs, is cancelled or is closed (`MOOT`). This happens inside the same
   transaction as the milestone or edit, so a completed step clears its alerts at once, not at the next tick.
5. **Acknowledge** marks the whole series (shipment + deadline) as seen. It does not stop alerts.
   **Snooze** (1h or 4h; 15 min to 24h allowed) holds back reminders and DUE for that deadline. **OVERDUE
   escalation to supervisors is never snoozed.**
6. **Notification centre** shows one card per open deadline (the newest alert, with a count of earlier
   ones). "Show resolved too" shows history. The 🔔 count is unread notifications.
7. **Channels:** `Notifier` interface (`src/lib/notify/index.ts`) with in-app, email, and a Telegram stub
   **[OPEN O5]**. Adding SMS/Viber = one class, no engine change. If one channel fails (e.g. SMTP down),
   the others still deliver and the error is stored on the alert. Failed emails are **not retried** in
   the MVP.
8. **Email without SMTP:** when `SMTP_HOST` is empty, emails are written to `OUTBOX_DIR` and shown at
   `/dev/outbox`, so the demo can show "the alert email" without a mail server.
9. **Rules editor** (`/admin/rules`, supervisor): BOC upload and arrastre have an editable base date + offset.
   Pick-up, FSI and pre-advise are due at the time CS enters, so only their alert timing (reminder hours,
   repeat interval, max/day) and on/off are editable. Saving recomputes deadlines on all open
   shipments and closes alerts whose due time moved.
10. **Simulated clock:** an offset stored in the database (`AppSetting`), so the web app and the separate
    scheduler process share it. It applies only when `ENABLE_DEV_TOOLS=true`. Logins and sessions always
    use real time. An amber banner shows on every page while it is active. `/dev/simulate-time` and
    `/dev/outbox` are supervisor-only and return 404 when dev tools are off. Each clock move also runs
    an alert check immediately.
11. **Scheduler** is a separate process (`npm run scheduler`, node-cron, every 5 minutes, Asia/Manila). It
    skips a tick if the previous one is still running. `npm run tick` runs once. The daily report job is
    added to this process in Step 6.
12. **Alert text is a snapshot** of the moment it was sent ("due in 4h"). The shipment page and board
    always show the live state.
13. **Timestamps under simulation:** alerts and in-app notifications record app time (simulated when
    active), so a demo timeline reads correctly. `readAt` uses real time.

## Step 5 decisions (field magic links)

1. **A link can be made for a named field person** (optional). Their name then appears on the timeline
   ("Carlo Dizon via Field link") although they never log in. Without a name, the event shows the
   source `FIELD_LINK` and no person.
2. **Only the SHA-256 hash of the token is stored.** The full URL is shown to CS once, when created
   (copy, SMS or Viber share buttons). If it is lost, CS creates a new one. Several links per shipment
   can be active at once (e.g. two field staff), and each can be revoked from the shipment page, which also
   shows "last used".
3. **Expiry is 7 days on the real clock** (security, like sessions). Simulated demo time does not
   extend or shorten it. Links stop working when the shipment is cancelled or closed.
4. **Field page shows only what is needed:** Job No., shipper, requested pick-up, the shipper's default
   pick-up address, cargo, destination, and current pick-up / declaration state. No consignee, HBL,
   prices or other shipments (Data Privacy Act: minimum necessary).
5. **Buttons:** Picked up (until done), Export declaration filed (while PENDING), Declaration released
   (until RELEASED). **ASSESSED** is set by CS only, since it is not in the spec's field buttons. Each button needs a
   **second tap within 5 seconds**, so a stray tap does not record a milestone.
6. **Repeated taps are harmless:** "already recorded (time)" is shown and nothing is written, e.g.
   after a retry on a weak mobile connection.
7. **Notes and photos:** optional note and phone-camera photo (JPG/PNG/WEBP/HEIC, max 10 MB) with any
   button, or on their own ("Send note / photo only"). The note on a milestone tap is stored on that
   milestone event. A photo, or a note sent on its own, is a separate `NOTE` event. Photos are
   `FIELD_PHOTO` attachments, viewable by CS from the timeline (login required).
8. **Milestone time = the moment of the tap.** Field staff cannot back-date. If the pick-up happened
   earlier, they say so in the note, or CS records it on their behalf with the right time (Step 2 fallback).
9. **Copy link works on plain HTTP too.** The browser clipboard API needs HTTPS, so on an office
   server reached as `http://192.168.x.x` the button falls back to the legacy copy command.
10. **No rate limiting** on `/f/{token}`. Tokens are 256-bit random, so guessing is not practical. Add
    rate limiting at the reverse proxy when deployed publicly.
