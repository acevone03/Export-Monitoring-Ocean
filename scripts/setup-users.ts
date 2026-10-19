// Sets up the real team from a users.csv file and removes the demo logins.
//
//   npm run setup-users            (reads users.csv in the project folder)
//   npm run setup-users -- other.csv
//
// users.csv, one person per line (header line optional):
//   name,email,role,title
//   Juan Dela Cruz,juan@company.ph,CS,CS Export Assistant
// role is CS, SUPERVISOR or FIELD. Supervisors manage users, rules and the import.
//
// New users get a temporary password, printed once here; they change it under My account.
// Existing users (same email) get their name, role and title updated; their password is kept.
// Demo logins (@nnr.test) are deleted, or switched off if old records still point to them
// (run `npm run clear-data` first to remove those records).
// users.csv holds staff emails: it is listed in .gitignore so it never goes to GitHub.

import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Prisma, PrismaClient, type Role } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { tempPassword } from "../src/lib/tokens";

const prisma = new PrismaClient();
const ROLES: Role[] = ["CS", "SUPERVISOR", "FIELD"];
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const DEMO = /@nnr\.test$/i;

type Row = { name: string; email: string; role: Role; title: string | null; line: number };

function readCsv(file: string): Row[] {
  if (!existsSync(file)) throw new Error(`File not found: ${file}. Create it first (see the top of scripts/setup-users.ts).`);
  const rows: Row[] = [];
  const errors: string[] = [];
  readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^name\s*,/i.test(line)) return;
    const [name = "", email = "", role = "", ...title] = line.split(",").map((c) => c.trim());
    const r = role.toUpperCase() as Role;
    if (!name) errors.push(`line ${i + 1}: name is missing`);
    else if (!EMAIL.test(email)) errors.push(`line ${i + 1} (${name}): "${email}" is not a valid email`);
    else if (!ROLES.includes(r)) errors.push(`line ${i + 1} (${name}): role must be CS, SUPERVISOR or FIELD, not "${role}"`);
    else rows.push({ name, email: email.toLowerCase(), role: r, title: title.join(",").trim() || null, line: i + 1 });
  });
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.email)) errors.push(`line ${r.line}: ${r.email} is listed twice`);
    seen.add(r.email);
  }
  if (!rows.some((r) => r.role === "SUPERVISOR")) errors.push("at least one person must be SUPERVISOR, or nobody can manage users");
  if (errors.length) throw new Error(`Please fix users.csv:\n  - ${errors.join("\n  - ")}`);
  return rows;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "users.csv";
  const rows = readCsv(file);

  const existing = await prisma.user.findMany({ select: { id: true, email: true } });
  const known = new Set(existing.map((u) => u.email.toLowerCase()));
  const demo = existing.filter((u) => DEMO.test(u.email));

  console.log(`\nFrom ${file}:`);
  for (const r of rows) console.log(`  ${known.has(r.email) ? "update" : "add   "}  ${r.name} <${r.email}>  ${r.role}${r.title ? ` · ${r.title}` : ""}`);
  console.log(`Demo logins to remove: ${demo.length}`);

  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ok = (await rl.question("\nType YES to continue: ")).trim().toUpperCase() === "YES";
    rl.close();
    if (!ok) return console.log("Cancelled. Nothing was changed.");
  }

  const created: Array<{ name: string; email: string; password: string }> = [];
  for (const r of rows) {
    if (known.has(r.email)) {
      await prisma.user.update({ where: { email: r.email }, data: { name: r.name, role: r.role, title: r.title, active: true } });
    } else {
      const password = tempPassword();
      await prisma.user.create({ data: { name: r.name, email: r.email, role: r.role, title: r.title, passwordHash: await hashPassword(password) } });
      created.push({ name: r.name, email: r.email, password });
    }
  }

  let deleted = 0;
  let switchedOff = 0;
  for (const u of demo) {
    await prisma.session.deleteMany({ where: { userId: u.id } });
    await prisma.notification.deleteMany({ where: { userId: u.id } });
    try {
      await prisma.user.delete({ where: { id: u.id } });
      deleted++;
    } catch (e) {
      // Still referenced by shipments or timeline entries: keep the record, but it can no longer log in.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")) throw e;
      await prisma.user.update({ where: { id: u.id }, data: { active: false } });
      switchedOff++;
    }
  }

  console.log(`\nDone: ${created.length} added, ${rows.length - created.length} updated, ${deleted} demo login(s) deleted${switchedOff ? `, ${switchedOff} switched off (still linked to old shipments; run npm run clear-data, then this again, to delete them)` : ""}.`);
  if (created.length) {
    console.log("\nTEMPORARY PASSWORDS: shown only now. Copy them, give each person theirs privately,");
    console.log("and ask them to change it under My account (click their name, top right).\n");
    const w = Math.max(...created.map((c) => c.email.length));
    for (const c of created) console.log(`  ${c.email.padEnd(w)}   ${c.password}   (${c.name})`);
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
