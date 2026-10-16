# NNR Export Monitor (MVP)

Export shipment monitoring for NNR Global Logistics: one record per shipment, auto-numbered
Job No. and HBL/HAWB, computed deadlines with escalating alerts, and daily/monthly reports.
All times are Asia/Manila; dates display as `DD-MMM-YYYY`, 24h time.

## Run (Node 20+)

```bash
npm install
cp .env.example .env
npm run setup        # creates the SQLite DB and loads demo data
npm run dev          # http://localhost:3000
```

Demo logins (password `nnr-demo-2026`): `sup1@nnr.test`, `sup2@nnr.test` (supervisor),
`cs1@nnr.test`, `cs2@nnr.test` (customer service), `field1@nnr.test`, `field2@nnr.test` (field).

To start over: delete `prisma/dev.db` and run `npm run setup` again.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (uses a throwaway `prisma/test.db`) |
| `npm run typecheck` | TypeScript check |
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
- [ ] 2. Shipment form + numbering + status machine + tests
- [ ] 3. Live board + shipment detail timeline
- [ ] 4. Deadline engine + scheduler + notifications + simulate-time
- [ ] 5. Field magic-link page
- [ ] 6. Daily and monthly reports + Excel export
- [ ] 7. AI email intake
- [ ] 8. Spreadsheet import, process-map page, docs
