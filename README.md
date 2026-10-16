# NNR Export Monitor (MVP)

**Ocean** export shipment monitoring for NNR Global Logistics: one record per shipment, auto-numbered
Job No. and HBL No., computed deadlines with escalating alerts, and daily/monthly reports.
All times are Asia/Manila; dates display as `DD-MMM-YYYY`, 24h time.

## Run (Node 20+)

```bash
npm install
cp .env.example .env
npm run setup        # creates the SQLite DB and loads demo data
npm run dev          # http://localhost:3000
```

For deadline alerts and the 07:30 daily report email, run the scheduler in a second terminal: `npm run scheduler`.

Demo logins (password `nnr-demo-2026`): `sup1@nnr.test`, `sup2@nnr.test` (supervisor),
`cs1@nnr.test`, `cs2@nnr.test` (customer service), `field1@nnr.test`, `field2@nnr.test` (field).

To start over: delete `prisma/dev.db` and run `npm run setup` again.

### Demo: watch a deadline go amber, then red

1. Log in as `sup1@nnr.test`, create a shipment with requested pick-up about 5 hours from now.
2. Open **Dev: time** (`/dev/simulate-time`) and click **+1 h**: the board row turns amber and a reminder arrives (🔔).
3. Click **+4 h**: the row turns red; DUE, then OVERDUE alerts arrive (overdue also goes to all supervisors).
4. Without SMTP configured, alert emails land in the outbox at `/dev/outbox`. Set `SMTP_*` in `.env` to send real email.
5. Mark the step done on the shipment page: its alerts close. **Reset to real time** when finished.

### AI email intake

Set `ANTHROPIC_API_KEY` in `.env` (and optionally `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) and restart.
CS paste a customer email at **From email** (`/intake`); the booking is pre-filled for review and only saved when CS confirm.
Without a key, the page shows a disabled notice and the manual form still works.

### Moving over from the spreadsheet

Supervisors import the old monitoring spreadsheet at **Import** (`/admin/import`): check first, then import.
Rows with problems are listed and downloadable as "rows to fix"; re-uploading is safe.
Accepted headers and rules: [`docs/import.md`](docs/import.md); a template: `docs/import-template.xlsx`.

### Process map

`/process` in the app, and [`docs/process-map.md`](docs/process-map.md) (Mermaid). Both come from
`src/lib/process-map.ts`; run `npm run docs` after changing it.

Dev tools exist only when `ENABLE_DEV_TOOLS=true`. Set it to `false` in production.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (uses a throwaway `prisma/test.db`) |
| `npm run typecheck` | TypeScript check |
| `npm run scheduler` | Background process: deadline alerts every 5 minutes, daily report email after 07:30 Manila |
| `npm run tick` | Run one scheduler tick now and exit |
| `npm run docs` | Regenerate `docs/process-map.md`, `docs/import.md`, `docs/import-template.xlsx` |
| `npm run db:migrate` | Create/apply a migration after editing `prisma/schema.prisma` |

## Layout

```
prisma/schema.prisma   data model (SQLite now, Postgres-compatible)
prisma/seed.ts         demo data: 15 shipments covering every status, some overdue
src/lib/               domain logic: numbering, status, deadlines, time, auth
src/app/               Next.js App Router pages and server actions
tests/                 Vitest unit tests
scripts/               scheduler process, docs generator
docs/                  process map, import guide and template (generated)
DECISIONS.md           every [OPEN]/[ASSUMPTION] and how it is resolved for now
```

## Definition of done (spec section 14)

Verified end to end in a browser: a supervisor logs in, pastes a customer email, confirms the extracted
shipment, sees the Job No. and HBL No. assigned, watches the pick-up deadline turn amber then red with
simulate-time, receives the alert email (outbox), marks the pick-up done from the field link on a phone,
and downloads the daily and monthly Excel reports. The AI step was run against a local mock of the
Anthropic API (no key in the build environment); set a real `ANTHROPIC_API_KEY` to use it live.

## Build progress (spec Section 13)

- [x] 1. Schema, auth, seed data
- [x] 2. Shipment form + numbering + status machine + tests
- [x] 3. Live board + shipment detail timeline
- [x] 4. Deadline engine + scheduler + notifications + simulate-time
- [x] 5. Field magic-link page
- [x] 6. Daily and monthly reports + Excel export
- [x] 7. AI email intake
- [x] 8. Spreadsheet import, process-map page, docs
