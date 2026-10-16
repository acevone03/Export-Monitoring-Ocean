import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser, can } from "@/lib/auth";
import { logoutAction } from "./login/actions";

export const metadata: Metadata = { title: "NNR Export Monitor" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        {user && (
          <header className="border-b border-slate-200 bg-white">
            <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
              <Link href="/" className="font-semibold text-blue-800">
                NNR Export Monitor
              </Link>
              <Link href="/" className="text-slate-700 hover:text-blue-700">Board</Link>
              {can.editShipments(user) && (
                <>
                  <Link href="/shipments/new" className="text-slate-700 hover:text-blue-700">New shipment</Link>
                  <Link href="/shippers" className="text-slate-700 hover:text-blue-700">Shippers</Link>
                </>
              )}
              {can.manageUsers(user) && (
                <Link href="/admin/users" className="text-slate-700 hover:text-blue-700">Users</Link>
              )}
              <span className="ml-auto text-slate-500">
                {user.name} · {user.role}
              </span>
              <form action={logoutAction}>
                <button className="btn-secondary py-1">Log out</button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
