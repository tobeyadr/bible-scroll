import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BOOKS } from '../public/books.js'
import { parseChapter } from '../public/parse.js'
import { loadIndex, search, parseQuery, parseReference, lookup } from '../public/search.js'
import { chapterText } from '../scripts/build-kjv.mjs'

const book = i => JSON.parse(readFileSync(new URL(`../public/kjv/${i}.json`, import.meta.url)))

test('chapterText numbers each verse and drops the brackets the verse format would misread', () => {
  const text = chapterText([
    { verse: '1', text: 'In the beginning  God created.' },
    { verse: '2', text: 'And the earth [was] without form.' },
  ])
  assert.equal(text, '[1] In the beginning God created. [2] And the earth was without form.')
})

test('every KJV chapter exists, parses, and its cards cover every verse in order', () => {
  let chapters = 0
  let verses = 0
  BOOKS.forEach((info, i) => {
    const texts = book(i)
    assert.equal(texts.length, info.c, `${info.n} chapter count`)
    texts.forEach((raw, ci) => {
      const label = `${info.n} ${ci + 1}`
      const marks = [...raw.matchAll(/\[(\d+)\]/g)].map(m => +m[1])
      assert.deepEqual(marks, marks.map((_, k) => k + 1), `${label} verses are numbered 1..n`)
      const cards = parseChapter(raw)
      assert.equal(cards[0].v1, 1, `${label} starts at verse 1`)
      assert.equal(cards.at(-1).v2, marks.length, `${label} ends at its last verse`)
      cards.forEach((card, k) => {
        assert.ok(card.v2 >= card.v1, `${label} card ${k} range`)
        if (k) assert.ok(card.v1 === cards[k - 1].v2 + 1, `${label} card ${k} follows on`)
      })
      chapters++
      verses += marks.length
    })
  })
  assert.equal(chapters, 1189)
  assert.equal(verses, 31102)
})

test('the KJV can be searched like the BSB, with its own wording', async () => {
  const index = await loadIndex(async b => book(b))
  assert.equal(index.length, 31102)
  const hit = search(index, parseQuery('shineth')).find(v => v.b === 42 && v.c === 1 && v.v === 5)
  assert.ok(hit, 'John 1:5 contains "shineth"')
  assert.deepEqual(lookup(index, parseReference('john 3:16')).map(v => v.text.slice(0, 20)), ['For God so loved the'])
  assert.equal(search(index, parseQuery('"thou art"')).length > 100, true)
})

test('the KJV text is the KJV, and has no stray markup', () => {
  const john3 = book(42)[2]
  assert.match(john3, /\[16\] For God so loved the world, that he gave his only begotten Son/)
  const psalm23 = book(18)[22]
  assert.match(psalm23, /\[1\] The LORD is my shepherd; I shall not want\./)
  for (let i = 0; i < BOOKS.length; i++) for (const raw of book(i)) assert.ok(!/[<>{}#]/.test(raw), `${BOOKS[i].n} has markup`)
})
