"use client";

import { useRouter } from "next/navigation";

/** Table row that opens a link on click or Enter, without breaking text selection or inner links. */
export function ClickableRow({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={`${className ?? ""} cursor-pointer`}
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a") || window.getSelection()?.toString()) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
