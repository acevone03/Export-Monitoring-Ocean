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

For deadline alerts, run the scheduler in a second terminal: `npm run scheduler` (checks every 5 minutes).

Demo logins (password `nnr-demo-2026`): `sup1@nnr.test`, `sup2@nnr.test` (supervisor),
`cs1@nnr.test`, `cs2@nnr.test` (customer service), `field1@nnr.test`, `field2@nnr.test` (field).

To start over: delete `prisma/dev.db` and run `npm run setup` again.

### Demo: watch a deadline go amber, then red

1. Log in as `sup1@nnr.test`, create a shipment with requested pick-up about 5 hours from now.
2. Open **Dev: time** (`/dev/simulate-time`) and click **+1 h**: the board row turns amber and a reminder arrives (🔔).
3. Click **+4 h**: the row turns red; DUE, then OVERDUE alerts arrive (overdue also goes to all supervisors).
4. Without SMTP configured, alert emails land in the outbox at `/dev/outbox`. Set `SMTP_*` in `.env` to send real email.
5. Mark the step done on the shipment page: its alerts close. **Reset to real time** when finished.

Dev tools exist only when `ENABLE_DEV_TOOLS=true`. Set it to `false` in production.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (uses a throwaway `prisma/test.db`) |
| `npm run typecheck` | TypeScript check |
| `npm run scheduler` | Background process: deadline alert engine every 5 minutes |
| `npm run tick` | Run one alert check now and exit |
| `npm run db:migrate` | Create/apply a migration after editing `prisma/schema.prisma` |

## Layout

```
prisma/schema.prisma   data model (SQLite now, Postgres-compatible)
prisma/seed.ts         demo data: 15 shipments covering every status, some overdue
src/lib/               domain logic: numbering, status, deadlines, time, auth
src/app/               Next.js App Router pages and server actions
tests/                 Vitest unit tests
DECISIONS.md           every [OPEN]/[ASSUMPTION] and how it is resolved for now
```

## Build progress (spec Section 13)

- [x] 1. Schema, auth, seed data
- [x] 2. Shipment form + numbering + status machine + tests
- [x] 3. Live board + shipment detail timeline
- [x] 4. Deadline engine + scheduler + notifications + simulate-time
- [x] 5. Field magic-link page
- [ ] 6. Daily and monthly reports + Excel export
- [ ] 7. AI email intake
- [ ] 8. Spreadsheet import, process-map page, docs
