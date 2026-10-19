// Builds src/data/scripture.json from the public-domain King James Version (1769 text),
// using the per-book JSON files of https://github.com/aruljohn/Bible-kjv (MIT).
//
//   git clone --depth 1 https://github.com/aruljohn/Bible-kjv /tmp/kjv
//   node scripts/gen-scripture.mjs /tmp/kjv
//
// Included: the Psalms, and the writings of the apostles and of Paul.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("Usage: node scripts/gen-scripture.mjs <path to Bible-kjv checkout>");
  process.exit(1);
}

// [file name in the source, display name, group]
const BOOKS = [
  ["Psalms", "Psalms", "Psalms"],
  ["Matthew", "Matthew", "Gospels and Acts"],
  ["John", "John", "Gospels and Acts"],
  ["Acts", "Acts", "Gospels and Acts"],
  ["Romans", "Romans", "Letters of Paul"],
  ["1Corinthians", "1 Corinthians", "Letters of Paul"],
  ["2Corinthians", "2 Corinthians", "Letters of Paul"],
  ["Galatians", "Galatians", "Letters of Paul"],
  ["Ephesians", "Ephesians", "Letters of Paul"],
  ["Philippians", "Philippians", "Letters of Paul"],
  ["Colossians", "Colossians", "Letters of Paul"],
  ["1Thessalonians", "1 Thessalonians", "Letters of Paul"],
  ["2Thessalonians", "2 Thessalonians", "Letters of Paul"],
  ["1Timothy", "1 Timothy", "Letters of Paul"],
  ["2Timothy", "2 Timothy", "Letters of Paul"],
  ["Titus", "Titus", "Letters of Paul"],
  ["Philemon", "Philemon", "Letters of Paul"],
  ["Hebrews", "Hebrews", "Letters of Paul"],
  ["James", "James", "Letters of the apostles"],
  ["1Peter", "1 Peter", "Letters of the apostles"],
  ["2Peter", "2 Peter", "Letters of the apostles"],
  ["1John", "1 John", "Letters of the apostles"],
  ["2John", "2 John", "Letters of the apostles"],
  ["3John", "3 John", "Letters of the apostles"],
  ["Jude", "Jude", "Letters of the apostles"],
  ["Revelation", "Revelation", "Letters of the apostles"],
];

const slug = (name) => name.toLowerCase().replace(/\s+/g, "-");

const books = BOOKS.map(([file, name, group]) => {
  const raw = JSON.parse(readFileSync(path.join(src, `${file}.json`), "utf8"));
  const chapters = raw.chapters.map((c, i) => {
    if (Number(c.chapter) !== i + 1) throw new Error(`${file}: chapter ${c.chapter} out of order`);
    return c.verses.map((v, j) => {
      if (Number(v.verse) !== j + 1) throw new Error(`${file} ${c.chapter}: verse ${v.verse} out of order`);
      return v.text.trim();
    });
  });
  return { name, slug: slug(name), group, chapters };
});

const out = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src", "data", "scripture.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ translation: "King James Version (KJV), public domain", books }));
const verses = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.length, 0), 0);
console.log(`Wrote ${out}: ${books.length} books, ${verses} verses`);
