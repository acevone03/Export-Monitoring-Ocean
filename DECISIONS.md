# Decisions

Every **[OPEN]** and **[ASSUMPTION]** from the spec, and anything decided during the build.
"Where" points to the single place to change it.

## Scope change: ocean export only

The spec covers ocean and air. **The product owner has narrowed the app to ocean export only**
(16-Oct-2026). Consequences:

- No `mode` field. Job No. is `EX-O-{YYMM}-{seq4}` and the house document is always an **HBL**
  (format: see "NNR's real monitoring sheet" below). The fixed "O" lives in `src/lib/numbering.ts` (`JOB_PREFIX`, `HBL_PREFIX`), so
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
| O4 | Arrastre deadline rule | `etdMnl - 24h`, only when arrastre = `NNR` (skipped when `SHIPPER`). Editable. *Now: the entered arrastre cut-off (see below).* | same |
| O5 | Extra notification channel | Telegram stub behind a `Notifier` interface (Step 4). | — |
| O6 | Mailbox reading / forwarding | Not built. CS pastes email text into `/intake` (Step 7). | — |

## Spec [ASSUMPTION] items

| # | Item | Implemented as | Where |
|---|---|---|---|
| A1 | HBL format | `NNRO{YY}{seq5}`, sequence per **year** (Manila calendar). *Now `NNRMNL{POD}{F|L}{seq}` (see below).* | `src/lib/numbering.ts` |
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
   Correcting a wrongly recorded step: see "Revert" below (resolved after Step 8).
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
   ETD, ATD, ETA, Status, CS, Remarks). The Excel "raw data" sheet (Step 6) will reuse it. *Superseded: see "NNR's real monitoring sheet" below.*
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

## Step 6 decisions (daily and monthly reports, Excel)

1. **Daily report scope follows access rules.** Supervisors get every shipment. Each CS gets a report of
   their own shipments (assigned or created), both on `/reports/daily` and in their 07:30 email. The
   spec says "email to supervisor and CS"; sending each CS everyone's shipments would bypass the Step 3
   access rule.
2. **07:30 delivery without a second timer.** On every 5-minute tick, the scheduler sends today's report
   once Manila app time is past 07:30. A `dailyReport:<date>` row is the once-per-day claim, so
   restarts or two schedulers never send it twice, and a scheduler started at 09:00 still sends that
   day's report. If sending fails the claim is released and the next tick retries. Jumping the
   simulated clock past 07:30 triggers it in demos. "Email it now" (supervisor) sends on demand and
   does not affect the automatic send.
3. **Daily sections** (spec order; Overdue moved to the top in red):
   Overdue = any of the five deadlines past due and not done (not after departure, Step 3 rule);
   Pick-ups today and tomorrow (requested pick-up, done or not); Cut-offs due today (FSI and
   pre-advise cut-off times falling today); Pending BOC uploads and arrastre payments (all open ones,
   not just today); Departed yesterday (ATD in yesterday, Manila); Missing mandatory data (Step 2 rule).
   Cancelled shipments never appear.
4. **The emailed report is a text summary** (max 25 lines per section) **plus the full Excel file**
   attached. No HTML email in the MVP.
5. **Monthly definitions** (`src/lib/reports/monthly.ts`):
   - *Totals by cargo type / destination / shipper* = shipments **created** (Job No. issued) in the
     month. Cancelled ones are counted separately and left out of the breakdowns. "By mode" is
     dropped (ocean only).
   - *On-time rate* = deadlines **falling due** in the month: on time = done at or before the due time.
     Missed = done late, or still open after the due time. Deadlines not yet due are left out. A step
     left open when the ship departed counts as missed (Step 3 rule).
   - *Average pick-up delay* = actual − requested, over pick-ups requested in the month (negative =
     early). *Average pick-up to ATD* = over shipments departing in the month.
   - *Arrastre on time vs late* = NNR arrastre deadlines falling due in the month.
   - Monthly report is supervisor-only (spec section 4).
6. **Excel:** real date cells showing Manila wall-clock time (`DD-MMM-YYYY HH:MM`), bold header rows,
   frozen panes, and an auto-filter on the raw sheet. Monthly: Summary, On-time rate, Missed deadlines,
   Missed by CS & shipper, Volume, Raw data. Daily: report + Raw data.
7. **Raw-data columns are an [ASSUMPTION]** until the real spreadsheet headers are provided. They are one
   list in `src/lib/columns.ts`; rename or reorder there and both exports follow. Unlike the board,
   the raw sheet has separate columns for each due time and done time (e.g. "FSI Cut-off" and "FSI
   Submitted").
8. **Downloads are access-checked route handlers** (`/reports/daily/export`, `/reports/monthly/export`)
   with `Cache-Control: private, no-store`. Anonymous requests are redirected to login, and CS get 403
   on the monthly export.

## Step 7 decisions (AI email intake)

1. **Model:** `claude-sonnet-4-6` as named in the spec, overridable with `ANTHROPIC_MODEL` (e.g. the newer
   `claude-sonnet-5-5`) without code changes. The model that read each email is stored on the intake.
2. **Structured output:** the Anthropic TypeScript SDK's `messages.parse` with a Zod schema
   (`output_config.format`). The response is schema-checked before use. Refusal, truncation,
   unparsable output and API errors (bad key, rate limit, network) become plain messages for CS.
3. **What is sent (Data Privacy Act):** only the pasted email text, the optional attachment text, and
   today's Manila date (needed for "next Tuesday"). No shipper list, user data or other database
   content is sent. **Shipper matching happens on our server** against the shipper master: an exact
   name match ignoring punctuation and Inc/Corp/Co/etc., else a single unambiguous partial match. It
   never guesses between several. The pasted email is wrapped as data and the model is told to ignore
   instructions inside it.
4. **Fields extracted** (spec list): shipper, destination, cargo type, container sizes/qty or LCL qty+unit,
   requested pick-up date (+ time if stated), other remarks. The model also returns a confidence level
   per field group, a `needs_review` flag for the date, the exact source words, and short notes for the
   reviewer.
5. **Dates:** relative dates are resolved from today's Manila date. Numeric dates like 10/11 are read as
   month/day (common in the Philippines) **and always flagged** for review. If no time is given,
   08:00 is pre-filled and flagged.
6. **Highlighting:** a field is outlined amber with a reason when the model was not fully confident,
   when it was not found, when the shipper needed a partial match or is unknown, or when we assumed
   something. POD is pre-filled from the destination and always flagged. Nothing is saved before CS
   press **Confirm**.
7. **Customer remarks go into "Carrier remarks"**, the only free-text field in the spec's data model. A
   separate "customer remarks" field would be a small schema change if wanted.
8. **The pasted email is saved before the AI call**, so nothing is lost if the AI is down. A failed
   extraction shows the error with **Try again** and **Enter manually**. **Discard** marks the intake
   REJECTED (kept for audit, never deleted).
9. **Double-confirm protection:** confirming claims the intake (PENDING_REVIEW → CONFIRMED) before the
   shipment is created. A second click or the back button cannot create a second shipment. If creation
   fails, the claim is released.
10. **Traceability:** the shipment's source is `EMAIL`, its CREATED event shows "via Email intake", and the
    shipment page links to the original email. CS see their own intakes; supervisors see all.
11. **[OPEN O6] Mailbox reading / forwarding** remains out of scope. A forwarding address could later feed
    the same `EmailIntake` table without changing the review step.
12. **Testing without a key:** unit tests inject a fake client. The end-to-end check pointed the real SDK
    at a local mock of the Messages endpoint via `ANTHROPIC_BASE_URL`. **Not yet verified against the
    live API**, which needs a real key.

## Step 8 decisions (spreadsheet import, process map, docs)

1. **Fixed column mapping, no mapping UI** (spec 10.4), in `src/lib/import/mapping.ts`. Each field accepts
   several header spellings (e.g. "Booking No." for Job No., "Pickup Date" for Requested Pick-up).
   **[ASSUMPTION]** until the real spreadsheet headers are confirmed. Adding a spelling is a one-line
   change, then run `npm run docs`. Unknown columns are listed and ignored. Missing Shipper, Destination
   or Cargo columns stop the import before anything is saved.
2. **Check first, then import.** "Check only" (ticked by default) validates every row and saves nothing. The
   real run imports each valid row in its own transaction. Invalid rows are listed with **all** their
   problems and can be downloaded as "rows to fix" (original values + an Error column) to correct and
   re-upload. Nothing fails silently.
3. **Same rules as the app:** every row goes through the shipment form's validation, plus: ATA needs ATD,
   and arrastre can't be paid by NNR when the shipper pays it. **Slash dates (10/11/2026) are rejected** as
   ambiguous; Excel date cells and `16-Oct-2026 09:00` / `2026-10-16 09:00` are read as Manila time.
4. **Numbers:** an HBL No. in the sheet is kept (already given to customers). A Job No. is kept when it
   is already in `EX-O-YYMM-####` form. Otherwise a new one is issued and the old booking number is shown
   on the timeline. Before any new number is generated, the counters are moved past every number kept
   from the file. (A test caught the bug where a generated HBL took a number used further down the file.)
5. **Re-import is safe:** rows whose HBL No., Job No. or old booking no. were already imported are skipped
   and listed. Rows with none of the three cannot be recognised, so upload only the "rows to fix" file
   after a partial import.
6. **Shippers:** exact name match (ignoring punctuation and Inc/Corp/Co). Unknown names are created when
   "Add shippers" is ticked. A *partial* match is refused with "did you mean …?" to avoid near-duplicate
   shippers.
7. **Assigned CS:** email (unique) or name. A name shared by two users is refused ("use their email"). Blank
   means the person importing.
8. **Status is recalculated from the dates** (only "Cancelled"/"Closed" are read from the sheet). Imported
   arrastre payments need no proof file (old records). **Report month** for an imported shipment is the
   earliest of requested pick-up, FSI cut-off and ETD, so history lands in the right month.
9. **Process map:** one Mermaid definition (`src/lib/process-map.ts`) renders on `/process` (bundled mermaid,
   no CDN) and is written to `docs/process-map.md` by `npm run docs`. A test fails if the doc and the
   app diverge. The same applies to `docs/import.md` and the import mapping.

## Still open after the MVP

- **Live test of AI intake** with a real `ANTHROPIC_API_KEY` (only mocked so far).
- **Telegram/SMS/Viber** channels are a stub (O5). **Mailbox reading** is not built (O6).
- **Production hardening** before go-live: HTTPS + `COOKIE_SECURE=true`, `ENABLE_DEV_TOOLS=false`, SMTP,
  Postgres (drop `connection_limit=1`), rate limiting on `/f/` and `/login` at the proxy, backups.

## After Step 8: revert a wrongly recorded step

1. **Supervisor-only "Revert…"** under each completed step on the shipment page (pick-up, FSI, pre-advise,
   BOC upload, arrastre, docs sent, departure, arrival), plus on the Closed and Cancelled banners
   (re-open / un-cancel). A reason is required.
2. **Nothing is deleted.** The step's timestamp is cleared, the original event stays on the timeline, and a
   `REVERTED` event records the old value, the reason and who did it. Status and deadlines are
   recomputed. A reverted arrastre payment keeps its proof file attached to the shipment.
3. **Alerts come back.** Alerts closed because the step was done (or because the shipment departed or was
   closed or cancelled) reopen when the deadline is open again with the same due time. They are not
   re-sent, and escalation continues from the current slot on the next tick.
4. **Order is kept:** revert Close before anything else on a closed shipment, the cancellation before
   anything else on a cancelled one, and the arrival before the departure. Export declaration status
   needs no revert because it can already be set to any value (logged).

## NNR's real monitoring sheet (after Step 8)

NNR shared its monitoring sheet (Oct 2026). The app now follows it. The file itself and any
real data are **not** in the repository; tests use invented rows under the real headers.

1. **HBL No. = `NNRMNL{POD}{F|L}{seq}`**, e.g. `NNRMNLTYOF9904`: Manila origin, the 3-letter
   destination code, F (FCL) or L (LCL), then one running number shared by all destinations (never reset
   by year). `HBL_START_AFTER` in `.env` (9903 = the last number in the sheet) sets where new numbers
   start; an import also moves the counter past every HBL in the file, including rows with errors.
2. **Destination code** (`podCode`) is filled from the destination by a city dictionary built from the
   sheet (`src/lib/pod-codes.ts`, e.g. TOKYO→TYO, PORT KLANG→PKL, LONG BEACH→LAX), else the UN/LOCODE's
   last 3 letters. CS can overwrite it on the form. An unknown city must be typed.
3. **The HBL is the main reference** on the board and in exports (first column, sticky). The Job No.
   (`EX-O-YYMM-####`) is kept for the internal timeline and reports but moved to the end. *(Confirmed.)*
4. **Arrastre cut-off is entered**, like FSI and pre-advise, from the shipping line's advice; the arrastre
   deadline is that time (rule: `arrastreCutoffAt` + 0h, editable in Rules). It is skipped when the shipper
   pays, and listed as missing until entered when NNR pays.
5. **Export declaration "c/o"**: who files it (`NNR` or `SHIPPER`) plus an optional forwarder.
   `C/O NNR (AAI)` = NNR files it through the forwarder **AAI** (`declarationForwarder`). *(Confirmed.)*
6. **Carrier column = shipping line or co-loader** (the sheet mixes both); one text field.
7. **Column V (second "date sent the export documents" column) = sent to NNR's overseas office**;
   the first is "to customer". *(Confirmed.)* It is its own step on the shipment page (date only, no
   deadline, revertible) and fills `exportDocsToOverseasAt`.
8. **"PART OF 7002"** in the HBL cell = split shipment. The row keeps its own HBL and links to the main
   one (`partOfHblNo`), shown on both shipment pages. *(Confirmed.)*
9. **"DIRECT BL"** rows get no NNR HBL (the line issues the BL); the text is kept in remarks. They are
   recognised on re-import by shipper + destination + pick-up + cargo.
10. **HBLs written `MNL…` (without NNR)** are kept as written. *(Confirmed.)*
11. **Board, raw Excel sheet and import share one column list** (`src/lib/nnr-sheet.ts`) with the sheet's 3
    header rows; app-only columns (Job No., status, CS, CS email, …) follow after a blank column, so an
    export re-imports cleanly.
12. **Dates without a year** (`04-Apr`): rows are in booking order, so each date takes the year nearest the
    previous row's. The first year is guessed so no date lands more than 120 days ahead, and can be set on
    the import page. *(Confirmed.)* `TBA`, `N/A`, `-` are blank; `15-16 MAY` takes the first day;
    `11 OCT @ 1200H` gives the time.
13. **History cut-off** (default 30 days ago): older rows import as **Closed** history. No alerts and
    no on-time scoring, because the sheet doesn't record when FSI or pre-advise were done, so every old row
    would count as missed. They still count in monthly volumes. Without this, about 1,100 old rows would
    have raised alerts at once.
14. **Shipper names** are matched ignoring spaces and punctuation. Names one typo apart (e.g. `ACME TRADNG`)
    are merged into the most used spelling. Every merge is listed on the check screen and can be turned off.
15. **Trial on the real file** (local copy only): 1,295 rows → 1,260 imported (1,126 history, 131 live),
    35 rows listed to fix (mostly blank destination, cargo or shipper; 3 HBLs used twice; 2 unreadable
    dates), start year 2025,
    next HBL after 9903. Re-importing the same file imports 0.

### Answers from NNR (17-Oct-2026)

1. Column V = docs sent to the **overseas office**.
2. Keep the Job No.; the HBL is the main reference: yes.
3. "(AAI)" = the **forwarder** NNR files the declaration through.
4. "PART OF 7002" = belongs to shipment 7002: yes.
5. The sheet is in booking order: yes.
6. Old `MNL…` HBLs stay as written: yes.

## Shipper codes, pick-up address auto-fill, Scripture (19-Oct-2026)

1. **Shipper code**: every shipper gets a permanent code `SHP-0001`, `SHP-0002`, … from its own
   counter (`NumberSequence` key `SHIPPER`), the same way Job and HBL numbers are issued. Codes are never
   reused or edited. Existing shippers were numbered in the order they were created (migration
   `20261019090000_shipper_code_pickup_address`).
2. **No repeated shipper names**: a new shipper is refused when its name matches an existing one ignoring
   case, spacing, punctuation and Inc/Corp/Co/Ltd/Phils (the same rule the import uses), e.g.
   "Food Flow, Inc." = "FOODFLOW INC". The error names the existing code. All creation goes through
   `src/lib/shippers.ts` (Shippers page, import, seed).
3. **[ASSUMPTION] "Client" = the shipper.** On a new shipment, typing the shipper's name *or code*
   fills the shipper, its contact line and a new per-shipment **Pick-up address** from the shipper's
   default address. CS can overwrite the address for one shipment; "Use the shipper's address" puts it back.
   Existing shipments got their shipper's default address. The field link and shipment page show it.
4. **Scripture**: the Psalms and the writings of the apostles and Paul (Matthew, John, Acts, Romans to
   Hebrews, James, 1–2 Peter, 1–3 John, Jude, Revelation), King James Version (public domain, from
   github.com/aruljohn/Bible-kjv, MIT). A verse of the day shows under the menu on every page and on the
   field link; it changes at Manila midnight and cycles through 100 chosen verses. `/scripture` has the
   full text by book and chapter, and a word search. Mark and Luke (not written by apostles) are left out;
   add them in `scripts/gen-scripture.mjs` if wanted.

## Pick-up instruction to transport (19-Oct-2026)

1. **New shipment** has a "Cargo and pick-up instruction" section that changes with the cargo type.
   FCL: booking number, HBL (assigned on save), positioning date/time, container yard, container size
   (tick 40 / 20 / 40HC / 20 Reefer / 40 Reefer and enter how many), port of loading
   (MICP/NORTH, SOUTH/ATI, PORT OF BATANGAS, SUBIC), cut-off (date only), remarks.
   LCL: booking number, HBL, consol, quantity, GW (kg), CBM, description, cargo dimension,
   delivery warehouse, remarks. Fields for the other cargo type are cleared on save.
2. **Dates on the instruction** are written `13/NOV/2026 13:00H` (positioning) and `13/NOV/2026` (cut-off), Manila time.
3. **Transport emails** are saved on the Transport page (AppSetting `TRANSPORT_EMAILS`). When CS create a shipment
   (form or email intake), the instruction is emailed to all of them right after save. The shipment is saved even if
   the email fails; the result shows on the shipment page and the timeline, and "Send / Resend to transport" sends it again.
   Edits do not resend automatically.
4. **[ASSUMPTION]** "SOUT/ATI" in the request is South Harbor (ATI), listed as `SOUTH/ATI`.
5. **Reefers**: container sizes `20RF` and `40RF` added. In the NNR sheet export, 20RF goes in the 20FT column and 40RF in the 40FT column.
