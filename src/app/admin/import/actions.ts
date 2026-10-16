"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now } from "@/lib/clock";
import { fromManila } from "@/lib/time";
import { errorsWorkbook, runImport, type ImportResult } from "@/lib/import/run";
import { ImportCellError } from "@/lib/import/parse";

export type ImportState = {
  error?: string;
  result?: Omit<ImportResult, "headers" | "headerRows">;
  errorsFile?: string; // base64 .xlsx of the rows to fix
  fileName?: string;
};

const MAX_BYTES = 10 * 1024 * 1024;

export async function importAction(_p: ImportState, form: FormData): Promise<ImportState> {
  const user = await requireUser(["SUPERVISOR"]);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the .xlsx file to import." };
  if (!/\.(xlsx|csv)$/i.test(file.name)) return { error: "Upload an Excel workbook (.xlsx) or a CSV file." };
  if (file.size > MAX_BYTES) return { error: "The file is larger than 10 MB." };

  try {
    const history = String(form.get("historyBefore") ?? "");
    const year = String(form.get("startYear") ?? "").trim();
    const result = await runImport(prisma, Buffer.from(await file.arrayBuffer()), {
      actor: user,
      now: await now(),
      dryRun: form.get("dryRun") === "on",
      createMissingShippers: form.get("createShippers") === "on",
      mergeSimilarShippers: form.get("mergeShippers") === "on",
      fileName: file.name,
      historyBefore: /^\d{4}-\d{2}-\d{2}$/.test(history) ? fromManila(+history.slice(0, 4), +history.slice(5, 7), +history.slice(8, 10)) : null,
      startYear: /^\d{4}$/.test(year) ? Number(year) : undefined,
    });
    const { headers: _h, headerRows: _r, ...rest } = result;
    if (!result.dryRun && result.imported > 0) revalidatePath("/");
    return {
      result: rest,
      fileName: file.name,
      errorsFile: result.errors.length ? (await errorsWorkbook(result)).toString("base64") : undefined,
    };
  } catch (e) {
    if (e instanceof ImportCellError) return { error: e.message };
    console.error("[import] failed:", e);
    return { error: "Could not read the file. Is it a valid .xlsx workbook?" };
  }
}
