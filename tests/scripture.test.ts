import { describe, expect, it } from "vitest";
import { BOOKS, DAILY_VERSES, getVerse, verseOfTheDay, formatRef } from "@/lib/scripture";
import { fromManila } from "@/lib/time";

describe("scripture", () => {
  it("includes the Psalms and the writings of the apostles and Paul", () => {
    const names = BOOKS.map((b) => b.name);
    for (const n of ["Psalms", "Matthew", "John", "Romans", "Philemon", "Hebrews", "James", "1 Peter", "3 John", "Jude", "Revelation"]) {
      expect(names).toContain(n);
    }
    expect(BOOKS.find((b) => b.name === "Psalms")!.chapters).toHaveLength(150);
    expect(getVerse("Psalms", 23, 1)?.text).toBe("The LORD is my shepherd; I shall not want.");
  });

  it("every daily verse exists, once", () => {
    for (const [b, c, v] of DAILY_VERSES) expect(getVerse(b, c, v), formatRef(b, c, v)).not.toBeNull();
    expect(new Set(DAILY_VERSES.map((r) => r.join())).size).toBe(DAILY_VERSES.length);
  });

  it("changes the verse at Manila midnight, not UTC midnight", () => {
    const evening = verseOfTheDay(fromManila(2026, 10, 19, 23, 59));
    const morning = verseOfTheDay(fromManila(2026, 10, 19, 0, 1));
    const nextDay = verseOfTheDay(fromManila(2026, 10, 20, 0, 1));
    expect(evening.ref).toBe(morning.ref);
    expect(nextDay.ref).not.toBe(morning.ref);
  });
});
