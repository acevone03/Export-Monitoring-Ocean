"use client";

import { useEffect, useState } from "react";
import { THEME_KEY } from "@/lib/theme";

// Light / Dark / System switch. The choice is remembered in this browser only (localStorage);
// THEME_SCRIPT (src/lib/theme.ts, run from layout.tsx) applies it before the page paints so there is no flash.

type Theme = "light" | "dark" | "system";

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    let saved: Theme = "system";
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === "light" || v === "dark" || v === "system") saved = v;
    } catch {}
    setTheme(saved);
  }, []);

  // Follow the computer's setting live while on System.
  useEffect(() => {
    apply(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function choose(t: Theme) {
    setTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  }

  const options: Array<{ value: Theme; icon: string; label: string }> = [
    { value: "light", icon: "☀️", label: "Light" },
    { value: "dark", icon: "🌙", label: "Dark" },
    { value: "system", icon: "💻", label: "System" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          title={`${o.label} theme`}
          onClick={() => choose(o.value)}
          className={`rounded px-1.5 py-0.5 ${theme === o.value ? "bg-blue-100 text-blue-900" : "text-slate-600 hover:bg-slate-100"}`}
        >
          <span aria-hidden>{o.icon}</span>
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
