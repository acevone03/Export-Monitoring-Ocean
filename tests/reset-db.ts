import { beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";

// Every test file starts from an empty database, so files don't depend on the order they run in
// (counters, user names and shipments left behind by another file).
beforeAll(async () => {
  const db = new PrismaClient();
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'",
  );
  await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const t of tables) await db.$executeRawUnsafe(`DELETE FROM "${t.name}"`);
  await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await db.$disconnect();
});
