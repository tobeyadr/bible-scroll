import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BOOKS } from '../public/books.js'
import { parseChapter } from '../public/parse.js'
import { loadIndex, search, parseQuery, parseReference, lookup } from '../public/search.js'
import { chapterToText } from '../scripts/build-bsb.mjs'

const book = i => JSON.parse(readFileSync(new URL(`../public/web/${i}.json`, import.meta.url)))
const bsb = i => JSON.parse(readFileSync(new URL(`../public/bsb/${i}.json`, import.meta.url)))

test('the space the API drops around the words of Jesus and footnotes is put back', () => {
  const verse = content => chapterToText([{ type: 'verse', number: 3, content }])
  assert.equal(
    verse(['Jesus answered him,', { text: '“Most certainly I tell you, unless one is born anew,', wordsOfJesus: true }, { noteId: 1 }, { text: 'he can’t see God’s Kingdom.”', wordsOfJesus: true }]),
    '[3] Jesus answered him, “Most certainly I tell you, unless one is born anew, he can’t see God’s Kingdom.”',
  )
  assert.equal(verse([{ text: 'He said,' }, { noteId: 1 }, { text: 'because it was so.' }]), '[3] He said, because it was so.')
  assert.equal(verse(['It runs by Assyria.', { lineBreak: true }, 'And the fourth river.']), '[3] It runs by Assyria. And the fourth river.')
})

test('every WEB chapter exists, parses, and its cards cover every verse in order', () => {
  let chapters = 0
  BOOKS.forEach((info, i) => {
    const texts = book(i)
    assert.equal(texts.length, info.c, `${info.n} chapter count`)
    texts.forEach((raw, ci) => {
      const label = `${info.n} ${ci + 1}`
      const marks = [...raw.matchAll(/\[(\d+)\]/g)].map(m => +m[1])
      assert.ok(marks.length > 0, `${label} has verses`)
      marks.forEach((m, k) => {
        if (k) assert.ok(m > marks[k - 1] && m <= marks[k - 1] + 3, `${label} verses run in order`) // a verse or two may be left out
      })
      const cards = parseChapter(raw)
      assert.equal(cards[0].v1, 1, `${label} starts at verse 1`)
      assert.equal(cards.at(-1).v2, marks.at(-1), `${label} ends at its last verse`)
      cards.forEach((card, k) => {
        assert.ok(card.v2 >= card.v1, `${label} card ${k} range`)
        // A verse can run on into the next card, and the WEB leaves out the odd verse, as the BSB does.
        if (k) assert.ok(card.v1 >= cards[k - 1].v2 && card.v1 <= cards[k - 1].v2 + 3, `${label} card ${k} follows on`)
      })
      chapters++
    })
  })
  assert.equal(chapters, 1189)
})

test('the WEB can be searched, with its own wording', async () => {
  const index = await loadIndex(async b => book(b))
  assert.ok(index.length > 31000, `${index.length} verses`)
  assert.match(lookup(index, parseReference('john 3:16'))[0].text, /^For God so loved the world, that he gave his only born Son/)
  assert.ok(search(index, parseQuery('"only born Son"')).length >= 1, 'WEB says "only born Son"')
})

test('the WEB text is the WEB, and has no stray markup', () => {
  assert.match(book(18)[22], /\[1\] The LORD is my shepherd;/)
  for (let i = 0; i < BOOKS.length; i++) {
    for (const raw of book(i)) assert.ok(!/[<>{}#]/.test(raw), `${BOOKS[i].n} has markup`)
  }
})

test('no BSB or WEB chapter has a comma, full stop or colon stuck to the next word', () => {
  const stuck = /[\p{Ll}][,;:][\p{L}“‘]|[\p{Ll}]{2}\.[\p{Lu}“‘]/u
  for (const read of [bsb, book]) {
    for (let i = 0; i < BOOKS.length; i++) {
      read(i).forEach((raw, ci) => {
        const hit = raw.match(stuck)
        assert.ok(!hit, `${BOOKS[i].n} ${ci + 1}: ${hit && raw.slice(Math.max(0, hit.index - 15), hit.index + 15)}`)
      })
    }
  }
})
