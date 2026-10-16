"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { now } from "@/lib/clock";
import { applyFieldUpdate, resolveFieldLink, FIELD_ACTIONS, type FieldPhoto } from "@/lib/field-links";
import { storage, MAX_UPLOAD_BYTES } from "@/lib/storage";

export type FieldState = { ok?: string; error?: string };

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif",
};

const Form = z.object({
  action: z.enum(FIELD_ACTIONS),
  note: z.string().trim().max(500, "Note is too long (500 characters max).").optional(),
});

// Public endpoint (no login): the token in the URL is the only credential.
export async function fieldAction(token: string, _prev: FieldState, form: FormData): Promise<FieldState> {
  const p = Form.safeParse({ action: form.get("action"), note: form.get("note") ?? undefined });
  if (!p.success) return { error: p.error.issues[0].message };

  // Check the link before storing anything.
  const link = await resolveFieldLink(prisma, token);
  if (!link.ok) return { error: "This link is no longer active. Ask CS for a new one." };

  let photo: FieldPhoto | null = null;
  const file = form.get("photo");
  if (file instanceof File && file.size > 0) {
    const ext = PHOTO_TYPES[file.type];
    if (!ext) return { error: "The photo must be a JPG, PNG, WEBP or HEIC image." };
    if (file.size > MAX_UPLOAD_BYTES) return { error: "The photo is larger than 10 MB." };
    const storageKey = await storage.put(Buffer.from(await file.arrayBuffer()), ext);
    photo = { storageKey, originalName: file.name.slice(0, 200) || `photo${ext}`, mimeType: file.type, sizeBytes: file.size };
  }

  const r = await applyFieldUpdate(prisma, token, p.data.action, { note: p.data.note ?? null, photo, now: await now() });
  revalidatePath(`/f/${token}`);
  return r.ok ? { ok: r.message } : { error: r.message };
}
