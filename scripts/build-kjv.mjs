// Downloads the King James Version (public domain in the United States) from github.com/aruljohn/Bible-kjv
// (MIT licensed JSON, one file per book) and writes one file per book to public/kjv/<book index>.json,
// each an array of chapter texts in the same plain-text shape as public/bsb/, so public/parse.js handles both.
//
//   node scripts/build-kjv.mjs
//
// The KJV source has no paragraph or poetry marks, so each chapter is one paragraph of "[n] verse" runs;
// parse.js cuts it into screen-sized cards at verse boundaries. The output is committed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { BOOKS } from '../public/books.js'

const RAW = 'https://raw.githubusercontent.com/aruljohn/Bible-kjv/master'
const OUT = new URL('../public/kjv/', import.meta.url)

// The verses of one chapter as "[1] text [2] text ...". Bracketed words (the KJV's italics in some
// editions) are kept without the brackets, since "[" is the verse mark in this format.
export function chapterText(verses) {
  return verses
    .map(v => `[${v.verse}] ${v.text.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim()}`)
    .join(' ')
}

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  let bytes = 0
  let verses = 0
  for (const [i, info] of BOOKS.entries()) {
    const data = await getJson(`${RAW}/${info.n.replace(/\s+/g, '')}.json`)
    if (data.chapters.length !== info.c) throw new Error(`${info.n}: ${data.chapters.length} chapters, expected ${info.c}`)
    const chapters = data.chapters.map((ch, k) => {
      if (+ch.chapter !== k + 1) throw new Error(`${info.n}: chapter ${ch.chapter} where ${k + 1} was expected`)
      ch.verses.forEach((v, n) => {
        if (+v.verse !== n + 1) throw new Error(`${info.n} ${ch.chapter}: verse ${v.verse} where ${n + 1} was expected`)
      })
      verses += ch.verses.length
      return chapterText(ch.verses)
    })
    const json = JSON.stringify(chapters)
    bytes += json.length
    writeFileSync(new URL(`${i}.json`, OUT), json)
  }
  console.log(`Wrote ${BOOKS.length} books, ${verses} verses, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) await main()
