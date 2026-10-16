import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// Fresh throwaway SQLite database for tests (never the dev database).
export default function setup() {
  const db = path.resolve(__dirname, "../prisma/test.db");
  rmSync(db, { force: true });
  rmSync(`${db}-journal`, { force: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
  });
}
