import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BOOKS } from '../public/books.js'
import { splitVerses, indexBook, parseQuery, search, highlight, snippet, parseReference, lookup, loadIndex, normalize } from '../public/search.js'

const verse = (b, c, v, text) => ({ b, c, v, text, key: ` ${normalize(text)} ` })
const ref = q => {
  const r = parseReference(q)
  return r && [BOOKS[r.b].n, r.c, r.v, r.verse]
}

test('splits a chapter into numbered verses and drops the unnumbered preamble', () => {
  const raw = 'For the choirmaster.\n\n[1] The LORD is my shepherd;\n    I shall not want.\n\n[2] He makes me lie down.'
  assert.deepEqual(splitVerses(raw), [
    { v: 1, text: 'The LORD is my shepherd; I shall not want.' },
    { v: 2, text: 'He makes me lie down.' },
  ])
})

test('normalising ignores case, punctuation, apostrophes and accents', () => {
  assert.equal(normalize('God’s “Word”, Café!'), 'gods word cafe')
})

test('parses words and quoted phrases, including an unfinished quote', () => {
  assert.deepEqual(parseQuery('love "Born Again" faith'), { terms: ['love', 'faith'], phrases: ['born again'] })
  assert.deepEqual(parseQuery('say "born ag'), { terms: ['say'], phrases: ['born ag'] })
})

const sample = [
  verse(0, 1, 1, 'In the beginning God created the heavens and the earth.'),
  verse(42, 3, 3, 'Jesus replied, “Truly, truly, I tell you, no one can see the kingdom of God unless he is born again.”'),
  verse(42, 3, 16, 'For God so loved the world that He gave His one and only Son.'),
  verse(45, 5, 8, 'But God proves His love for us in this: While we were still sinners, Christ died for us.'),
]

test('every word must match, as a word start', () => {
  const hit = q => search(sample, parseQuery(q)).map(v => `${v.c}:${v.v}`)
  assert.deepEqual(hit('god love'), ['5:8', '3:16']) // "loved" matches the prefix "love"
  assert.deepEqual(hit('earth heaven'), ['1:1'])
  assert.deepEqual(hit('zebra'), [])
  assert.deepEqual(hit('ove'), []) // not the start of a word
})

test('phrases must appear together, and whole words rank above prefixes', () => {
  assert.deepEqual(search(sample, parseQuery('"born again"')).map(v => v.v), [3])
  assert.deepEqual(search(sample, parseQuery('"again born"')), [])
  assert.deepEqual(search(sample, parseQuery('love')).map(v => v.v), [8, 16]) // whole word "love" before "loved"
})

test('highlights matched words and windows long verses around the first match', () => {
  const q = parseQuery('kingdom')
  assert.deepEqual(
    highlight('see the kingdom of God', q).filter(s => s.hit).map(s => s.t),
    ['kingdom'],
  )
  // inside a phrase "so" is the word itself, not the start of "Son"
  assert.deepEqual(
    highlight('so loved that only Son', parseQuery('"so loved"')).filter(s => s.hit).map(s => s.t),
    ['so', 'loved'],
  )
  const long =`${'filler '.repeat(60)}kingdom ${'tail '.repeat(60)}`.trim()
  const segs = snippet(long, q, 120)
  assert.equal(segs[0].t, '…')
  assert.equal(segs.at(-1).t, '…')
  assert.ok(segs.some(s => s.hit && s.t === 'kingdom'))
  assert.ok(segs.map(s => s.t).join('').length < 160)
})

test('reads references and abbreviations', () => {
  assert.deepEqual(ref('John 3:16'), ['John', 3, 16, true])
  assert.deepEqual(ref('john 3 16'), ['John', 3, 16, true])
  assert.deepEqual(ref('jn3:16-18'), ['John', 3, 16, true])
  assert.deepEqual(ref('1 cor 13'), ['1 Corinthians', 13, 1, false])
  assert.deepEqual(ref('1john 4'), ['1 John', 4, 1, false])
  assert.deepEqual(ref('ps 23'), ['Psalms', 23, 1, false])
  assert.deepEqual(ref('song of solomon 2:4'), ['Song of Solomon', 2, 4, true])
  assert.deepEqual(ref('Genesis'), ['Genesis', 1, 1, false])
  assert.deepEqual(ref('jude 5'), ['Jude', 1, 5, true]) // one-chapter book: the number is the verse
  assert.deepEqual(ref('phil 2'), ['Philippians', 2, 1, false])
})

test('reads verse ranges and flags whether a chapter or verse was typed', () => {
  assert.deepEqual(parseReference('john 3:16-18'), { b: 42, c: 3, v: 16, v2: 18, verse: true, chapter: true })
  assert.deepEqual(parseReference('john 3:16'), { b: 42, c: 3, v: 16, v2: 16, verse: true, chapter: true })
  assert.deepEqual(parseReference('jude 5–8'), { b: 64, c: 1, v: 5, v2: 8, verse: true, chapter: true })
  assert.deepEqual(parseReference('john 3'), { b: 42, c: 3, v: 1, v2: 1, verse: false, chapter: true })
  assert.deepEqual(parseReference('john'), { b: 42, c: 1, v: 1, v2: 1, verse: false, chapter: false })
})

test('looks up a verse, a range, or a whole chapter in the index', () => {
  const index = [verse(42, 3, 15, 'a'), verse(42, 3, 16, 'b'), verse(42, 3, 17, 'c'), verse(42, 3, 18, 'd'), verse(42, 4, 1, 'e')]
  const vs = q => lookup(index, parseReference(q)).map(x => `${x.c}:${x.v}`)
  assert.deepEqual(vs('john 3:16'), ['3:16'])
  assert.deepEqual(vs('john 3:16-17'), ['3:16', '3:17'])
  assert.deepEqual(vs('john 3'), ['3:15', '3:16', '3:17', '3:18'])
  assert.deepEqual(vs('john 3:99'), [])
})

test('does not mistake ordinary searches for references', () => {
  for (const q of ['love', 'the lord is my shepherd', 'in', 'john 99', 'psalm 151', '3', '']) assert.equal(parseReference(q), null, q)
})

test('index of the real BSB finds John 3:16 and has the expected verse count', async () => {
  const loadBook = async b => JSON.parse(await readFile(new URL(`../public/bsb/${b}.json`, import.meta.url), 'utf8'))
  let last = 0
  const index = await loadIndex(loadBook, done => (last = done))
  assert.equal(last, 66)
  assert.ok(index.length > 31000 && index.length < 31200, `verses: ${index.length}`)
  const [first] = search(index, parseQuery('"so loved the world"'))
  assert.deepEqual([BOOKS[first.b].n, first.c, first.v], ['John', 3, 16])
  // Bible order is kept, so ties read from Genesis forward
  const gods = search(index, parseQuery('beginning created heavens'))
  assert.deepEqual([gods[0].b, gods[0].c, gods[0].v], [0, 1, 1])
  assert.ok(indexBook(0, ['[1] a [2] b']).length === 2)
})
