// Downloads the Berean Standard Bible (public domain) from the free bible.helloao.org API and writes
// one file per book to public/bsb/<book index>.json, each an array of chapter texts in the same
// plain-text shape the ESV API returns, so public/parse.js handles both.
//
//   node scripts/build-bsb.mjs
//
// The output is committed, so deploying does not need network access or this script.
import { mkdirSync, writeFileSync } from 'node:fs'
import { BOOKS } from '../public/books.js'

const API = 'https://bible.helloao.org'
const OUT = new URL('../public/bsb/', import.meta.url)

// Book ids in the API's canonical order, which matches BOOKS.
export const IDS ='GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ')

export function chapterToText(content) {
  const blocks = []
  let cur = null
  const start = kind => {
    if (!cur || cur.kind !== kind) {
      cur = { kind, lines: [] }
      blocks.push(cur)
    }
  }

  for (const part of content) {
    if (part.type === 'line_break') {
      cur = null
    } else if (part.type === 'hebrew_subtitle') {
      cur = null
      start('prose')
      // The pieces of a Psalm title ("...according to Sheminith." / "A Psalm of David.") come without a space between.
      cur.lines.push(part.content.filter(x => typeof x === 'string').join(' ').replace(/\s+/g, ' ').trim())
      cur = null
    } else if (part.type === 'verse') {
      let number = part.number
      let first = true
      const marker = () => {
        const m = number != null ? `[${number}] ` : ''
        number = null
        return m
      }
      let gap = false // a footnote sat between two words; the API drops the space around it
      let wasRed = false // the last piece was the words of Jesus
      for (const item of part.content) {
        const text = typeof item === 'string' ? item : item.text
        if (text != null && item.poem != null) {
          start('poetry')
          cur.lines.push(' '.repeat(item.poem * 2) + marker() + text.trim())
        } else if (typeof item === 'string' && cur?.kind === 'poetry') {
          // A bare "Selah" after poetry lines.
          cur.lines.push('    ' + marker() + item.trim())
        } else if (text != null) {
          start('prose')
          let piece = marker() + text
          if (!cur.lines.length) {
            cur.lines.push(piece.trimStart())
          } else {
            const line = cur.lines[0]
            // The API also drops the space between pieces where the words of Jesus start or stop ("answered him,“Most
            // certainly") or split ("the deaf hear," / "the dead are raised"), so a word or an opening quote after
            // closing punctuation gets one back, and an opening quote or bracket after a word at a seam.
            const seam = gap || !!item.wordsOfJesus !== wasRed
            if (
              first ||
              (gap && /[\p{L}\p{N}]$/u.test(line) && /^[\p{L}\p{N}]/u.test(piece)) ||
              (/[,.;:!?”’)]$/u.test(line) && /^[\p{L}\p{N}“‘(]/u.test(piece)) ||
              (seam && /[\p{L}\p{N}]$/u.test(line) && /^[“‘(]/u.test(piece))
            ) {
              piece = ' ' + piece
            }
            cur.lines[0] = line + piece
          }
        } else if (item.noteId != null) {
          gap = true
        } else if (item.lineBreak && item.paragraph) {
          cur = null
        } else if (item.lineBreak) {
          gap = true // a line break inside a verse's prose ("Assyria." / "And the fourth river") reads as a space
        }
        if (text != null) {
          first = false
          gap = false
          wasRed = !!item.wordsOfJesus
        }
      }
    }
  }

  return blocks
    .map(b => (b.kind === 'prose' ? b.lines[0].replace(/\s+/g, ' ').trim() : b.lines.join('\n')))
    .filter(Boolean)
    .join('\n\n')
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const res = await fetch(`${API}/api/BSB/complete.json`)
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
