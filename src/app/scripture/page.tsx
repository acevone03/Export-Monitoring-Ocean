import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { now } from "@/lib/clock";
import { formatDate } from "@/lib/time";
import { BOOKS, BOOK_GROUPS, TRANSLATION, formatRef, getBook, verseOfTheDay } from "@/lib/scripture";

type Params = { book?: string; ch?: string; q?: string };
const MAX_RESULTS = 100;

export default async function ScripturePage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const p = await searchParams;
  const today = await now();
  const daily = verseOfTheDay(today);

  const q = (p.q ?? "").trim();
  const book = getBook(p.book ?? "") ?? (q ? null : getBook(daily.slug));
  const chapterCount = book?.chapters.length ?? 0;
  const ch = book ? Math.min(Math.max(Number(p.ch) || (p.book ? 1 : daily.chapter), 1), chapterCount) : 0;
  const verses = book ? book.chapters[ch - 1] : [];

  // Plain word search over every included book.
  const results: Array<{ ref: string; slug: string; chapter: number; verse: number; text: string }> = [];
  let total = 0;
  if (q.length >= 3) {
    const needle = q.toLowerCase();
    for (const b of BOOKS)
      b.chapters.forEach((vs, ci) =>
        vs.forEach((text, vi) => {
          if (!text.toLowerCase().includes(needle)) return;
          total++;
          if (results.length < MAX_RESULTS) results.push({ ref: formatRef(b.name, ci + 1, vi + 1), slug: b.slug, chapter: ci + 1, verse: vi + 1, text });
        }),
      );
  }

  const href = (slug: string, chapter: number, verse?: number) => `/scripture?book=${slug}&ch=${chapter}${verse ? `#v${verse}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Scripture</h1>
          <p className="text-sm text-slate-600">The Psalms and the writings of the apostles and Paul · {TRANSLATION}</p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} minLength={3} className="input py-1" placeholder="Search a word, e.g. peace" aria-label="Search verses" />
          <button className="btn-secondary py-1">Search</button>
        </form>
      </div>

      <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-800">Verse for {formatDate(today)}</p>
        <blockquote className="mt-1 font-serif text-lg leading-relaxed text-slate-900">{daily.text}</blockquote>
        <Link href={href(daily.slug, daily.chapter, daily.verse)} className="mt-1 inline-block text-sm font-medium text-amber-900 hover:underline">
          — {daily.ref}
        </Link>
      </section>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav className="card space-y-4 self-start text-sm" aria-label="Books">
          {BOOK_GROUPS.map((g) => (
            <div key={g}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {BOOKS.filter((b) => b.group === g).map((b) => (
                  <li key={b.slug}>
                    <Link href={href(b.slug, 1)} className={b.slug === book?.slug ? "font-semibold text-blue-800" : "text-slate-700 hover:text-blue-700"}>{b.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {q ? (
          <section className="card space-y-3">
            <h2 className="font-semibold">
              {q.length < 3 ? "Type at least 3 letters to search." : `${total} verse${total === 1 ? "" : "s"} with "${q}"${total > MAX_RESULTS ? ` (first ${MAX_RESULTS} shown)` : ""}`}
            </h2>
            <ul className="space-y-3">
              {results.map((r) => (
                <li key={r.ref}>
                  <Link href={href(r.slug, r.chapter, r.verse)} className="text-sm font-medium text-blue-800 hover:underline">{r.ref}</Link>
                  <p className="font-serif leading-relaxed text-slate-800">{r.text}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : book ? (
          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{formatRef(book.name, ch)}</h2>
              <div className="flex items-center gap-2 text-sm">
                {ch > 1 && <Link href={href(book.slug, ch - 1)} className="btn-secondary py-1">← {ch - 1}</Link>}
                {ch < chapterCount && <Link href={href(book.slug, ch + 1)} className="btn-secondary py-1">{ch + 1} →</Link>}
              </div>
            </div>
            {chapterCount > 1 && (
              <div className="flex flex-wrap gap-1 text-xs" aria-label="Chapters">
                {book.chapters.map((_, i) => (
                  <Link
                    key={i}
                    href={href(book.slug, i + 1)}
                    className={`min-w-7 rounded px-1.5 py-0.5 text-center ${i + 1 === ch ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    {i + 1}
                  </Link>
                ))}
              </div>
            )}
            <ol className="space-y-1.5 font-serif text-[17px] leading-relaxed text-slate-900">
              {verses.map((text, i) => {
                const isDaily = book.slug === daily.slug && ch === daily.chapter && i + 1 === daily.verse;
                return (
                  <li key={i} id={`v${i + 1}`} className={`scroll-mt-20 rounded px-1 target:bg-amber-100 ${isDaily ? "bg-amber-50" : ""}`}>
                    <sup className="mr-1 font-sans text-xs font-semibold text-slate-400">{i + 1}</sup>
                    {text}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
      </div>
    </div>
  );
}
