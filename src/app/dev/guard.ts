import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { devToolsEnabled } from "@/lib/clock";

/** Dev tools exist only when ENABLE_DEV_TOOLS=true, and only for supervisors. Otherwise 404. */
export async function requireDevTools() {
  if (!devToolsEnabled()) notFound();
  return requireUser(["SUPERVISOR"]);
}
