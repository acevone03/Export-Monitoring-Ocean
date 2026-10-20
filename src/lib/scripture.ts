import data from "@/data/scripture.json";
import { manilaParts } from "./time";

// Bible verses from the Psalms and the writings of the apostles and Paul (KJV, public domain).
// The text lives in src/data/scripture.json (built by scripts/gen-scripture.mjs) and is only
// read on the server, so it never ships to the browser in full.

export type ScriptureBook = { name: string; slug: string; group: string; chapters: string[][] };
export type Verse = { book: string; slug: string; chapter: number; verse: number; text: string; ref: string };

export const TRANSLATION: string = data.translation;
export const BOOKS: ScriptureBook[] = data.books;
export const BOOK_GROUPS = [...new Set(BOOKS.map((b) => b.group))];

export const getBook = (slug: string) => BOOKS.find((b) => b.slug === slug) ?? null;

/** "Psalm 23:1" for a single psalm, "Romans 8:28" otherwise. */
export function formatRef(book: string, chapter: number, verse?: number) {
  const name = book === "Psalms" ? "Psalm" : book;
  return verse ? `${name} ${chapter}:${verse}` : `${name} ${chapter}`;
}

export function getVerse(book: string, chapter: number, verse: number): Verse | null {
  const b = BOOKS.find((x) => x.name === book);
  const text = b?.chapters[chapter - 1]?.[verse - 1];
  return b && text ? { book: b.name, slug: b.slug, chapter, verse, text, ref: formatRef(b.name, chapter, verse) } : null;
}

// Verses chosen to stand on their own for the daily banner, spread over every group.
// Each one is checked against the text in tests/scripture.test.ts.
export const DAILY_VERSES: Array<[book: string, chapter: number, verse: number]> = [
  ["Psalms", 23, 1], ["Matthew", 6, 33], ["Romans", 8, 28], ["James", 1, 5], ["Psalms", 46, 1],
  ["John", 14, 27], ["Philippians", 4, 13], ["1 Peter", 5, 7], ["Psalms", 118, 24], ["Galatians", 6, 9],
  ["Psalms", 119, 105], ["John", 3, 16], ["Colossians", 3, 23], ["1 John", 4, 19], ["Psalms", 37, 5],
  ["Matthew", 11, 28], ["2 Corinthians", 5, 17], ["Hebrews", 13, 8], ["Psalms", 121, 2], ["Acts", 20, 35],
  ["Ephesians", 4, 32], ["James", 1, 17], ["Psalms", 27, 1], ["John", 15, 5], ["Romans", 12, 12],
  ["2 Timothy", 1, 7], ["Psalms", 55, 22], ["Matthew", 5, 16], ["1 Thessalonians", 5, 18], ["Revelation", 21, 4],
  ["Psalms", 90, 12], ["John", 8, 12], ["Philippians", 4, 6], ["1 Peter", 4, 8], ["Psalms", 127, 1],
  ["Matthew", 7, 7], ["Romans", 15, 13], ["Hebrews", 11, 1], ["Psalms", 16, 8], ["John", 16, 33],
  ["1 Corinthians", 16, 14], ["James", 1, 19], ["Psalms", 37, 4], ["Acts", 1, 8], ["Ephesians", 3, 20],
  ["Psalms", 28, 7], ["John", 14, 6], ["Galatians", 6, 2], ["2 Peter", 3, 18], ["Psalms", 32, 8],
  ["Matthew", 5, 9], ["Romans", 12, 21], ["1 John", 1, 9], ["Psalms", 56, 3], ["Colossians", 3, 15],
  ["Hebrews", 4, 16], ["Psalms", 73, 26], ["John", 13, 34], ["Philippians", 1, 6], ["1 Timothy", 4, 12],
  ["Psalms", 100, 4], ["Matthew", 28, 20], ["2 Corinthians", 12, 9], ["James", 1, 22], ["Psalms", 103, 2],
  ["John", 10, 10], ["Romans", 5, 8], ["1 Thessalonians", 5, 11], ["Psalms", 139, 14], ["Jude", 1, 24],
  ["Ephesians", 6, 10], ["Psalms", 143, 8], ["John", 15, 13], ["Hebrews", 10, 24], ["Psalms", 18, 2],
  ["Matthew", 19, 26], ["1 Corinthians", 15, 58], ["1 John", 3, 18], ["Psalms", 34, 8], ["Titus", 3, 5],
  ["Galatians", 5, 22], ["Psalms", 107, 1], ["John", 11, 25], ["2 Thessalonians", 3, 13], ["Revelation", 3, 20],
  ["Psalms", 147, 3], ["Matthew", 22, 37], ["Romans", 8, 31], ["1 Peter", 3, 15], ["Psalms", 30, 5],
  ["Philippians", 4, 4], ["Psalms", 19, 14], ["Colossians", 3, 17], ["2 Timothy", 4, 7], ["Psalms", 145, 18],
  ["Hebrews", 13, 5], ["Psalms", 4, 8], ["James", 5, 16], ["Psalms", 150, 6], ["Ephesians", 2, 8],
];

/** Day number in Manila (whole days since 1970-01-01), so the verse changes at local midnight. */
export function manilaDayNumber(at: Date) {
  const p = manilaParts(at);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

/** The same verse for everyone all day; a new one each day, cycling through DAILY_VERSES. */
export function verseOfTheDay(at: Date): Verse {
  const list = DAILY_VERSES;
  const [book, chapter, verse] = list[((manilaDayNumber(at) % list.length) + list.length) % list.length];
  return getVerse(book, chapter, verse) ?? getVerse("Psalms", 23, 1)!;
}
