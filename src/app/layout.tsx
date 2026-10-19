import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { prisma } from "@/lib/db";
import { getCurrentUser, can } from "@/lib/auth";
import { devToolsEnabled, getClockOffsetMs, now } from "@/lib/clock";
import { formatDateTime } from "@/lib/time";
import { verseOfTheDay } from "@/lib/scripture";
import { logoutAction } from "./login/actions";

export const metadata: Metadata = { title: "NNR Export Monitor" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const staff = user && (user.role === "CS" || user.role === "SUPERVISOR");
  const [unread, offset] = await Promise.all([
    staff ? prisma.notification.count({ where: { userId: user.id, readAt: null } }) : Promise.resolve(0),
    user ? getClockOffsetMs() : Promise.resolve(0),
  ]);
  const simulated = offset !== 0 ? await now() : null;
  const verse = user ? verseOfTheDay(simulated ?? new Date()) : null;
  const dev = user?.role === "SUPERVISOR" && devToolsEnabled();

  return (
    <html lang="en">
      <body>
        {simulated && (
          <div className="bg-amber-400 px-4 py-1 text-center text-sm font-medium text-amber-950">
            Simulated time: {formatDateTime(simulated)} (dev).{" "}
            {dev && <Link href="/dev/simulate-time" className="underline">Change or reset</Link>}
          </div>
        )}
        {user && (
          <header className="border-b border-slate-200 bg-white">
            <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <Link href="/" className="font-semibold text-blue-800">NNR Export Monitor</Link>
              <Link href="/" className="text-slate-700 hover:text-blue-700">Board</Link>
              {can.editShipments(user) && (
                <>
                  <Link href="/shipments/new" className="text-slate-700 hover:text-blue-700">New shipment</Link>
                  <Link href="/intake" className="text-slate-700 hover:text-blue-700">From email</Link>
                  <Link href="/shippers" className="text-slate-700 hover:text-blue-700">Shippers</Link>
                  <Link href="/transport" className="text-slate-700 hover:text-blue-700">Transport</Link>
                </>
              )}
              {can.viewDailyReport(user) && <Link href="/reports/daily" className="text-slate-700 hover:text-blue-700">Daily report</Link>}
              {can.viewMonthlyReport(user) && <Link href="/reports/monthly" className="text-slate-700 hover:text-blue-700">Monthly report</Link>}
              {can.editRules(user) && <Link href="/admin/rules" className="text-slate-700 hover:text-blue-700">Rules</Link>}
              {can.manageUsers(user) && <Link href="/admin/users" className="text-slate-700 hover:text-blue-700">Users</Link>}
              {can.manageUsers(user) && <Link href="/admin/import" className="text-slate-700 hover:text-blue-700">Import</Link>}
              <Link href="/process" className="text-slate-700 hover:text-blue-700">Process</Link>
              <Link href="/scripture" className="text-slate-700 hover:text-blue-700">Scripture</Link>
              {dev && <Link href="/dev/simulate-time" className="text-amber-700 hover:text-amber-900">Dev: time</Link>}
              <span className="ml-auto flex items-center gap-3">
                {staff && (
                  <Link href="/notifications" className="relative text-slate-700 hover:text-blue-700" aria-label={`Notifications, ${unread} unread`}>
                    <span aria-hidden>🔔</span>
                    {unread > 0 && (
                      <span className="absolute -right-3 -top-2 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{unread > 99 ? "99+" : unread}</span>
                    )}
                  </Link>
                )}
                <span className="text-slate-500">{user.name} · {user.role}</span>
                <form action={logoutAction}>
                  <button className="btn-secondary py-1">Log out</button>
                </form>
              </span>
            </nav>
            {verse && (
              <Link
                href={`/scripture?book=${verse.slug}&ch=${verse.chapter}#v${verse.verse}`}
                className="block border-t border-amber-100 bg-amber-50 px-4 py-1.5 text-center text-sm text-amber-950 hover:bg-amber-100"
                title="Verse of the day: open the chapter"
              >
                <span aria-hidden>📖 </span>
                <span className="font-serif italic">{verse.text}</span>
                <span className="ml-1 whitespace-nowrap font-medium"> — {verse.ref}</span>
              </Link>
            )}
          </header>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
