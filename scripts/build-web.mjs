// Downloads the World English Bible (public domain) from the free bible.helloao.org API, the same source and
// format as the BSB, and writes one file per book to public/web/<book index>.json in the same plain-text shape
// as public/bsb/, so public/parse.js handles both.
//
//   node scripts/build-web.mjs
//
// The output is committed, so deploying does not need network access or this script.
import { mkdirSync, writeFileSync } from 'node:fs'
import { BOOKS } from '../public/books.js'
import { chapterToText, IDS } from './build-bsb.mjs'

const API = 'https://bible.helloao.org'
const OUT = new URL('../public/web/', import.meta.url)

async function main() {
  mkdirSync(OUT, { recursive: true })
  const res = await fetch(`${API}/api/ENGWEBP/complete.json`)
  if (!res.ok) throw new Error(`complete.json: HTTP ${res.status}`)
  const data = await res.json()
  if (data.books.length !== BOOKS.length) throw new Error(`Expected ${BOOKS.length} books, got ${data.books.length}`)

  let bytes = 0
  data.books.forEach((book, i) => {
    if (book.id !== IDS[i]) throw new Error(`Book ${i} is ${book.id}, expected ${IDS[i]}`)
    if (book.chapters.length !== BOOKS[i].c) throw new Error(`${book.id}: ${book.chapters.length} chapters, expected ${BOOKS[i].c}`)
    const chapters = book.chapters.map(ch => chapterToText((ch.chapter ?? ch).content))
    const json = JSON.stringify(chapters)
    bytes += json.length
    writeFileSync(new URL(`${i}.json`, OUT), json)
  })
  console.log(`Wrote ${data.books.length} books, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) await main()
