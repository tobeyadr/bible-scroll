import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChapter, plainText } from '../public/parse.js'
import { parseHash, nextChapter, prevChapter } from '../public/books.js'

const prose = n => Array.from({ length: n }, (_, i) => `[${i + 1}] ${'word '.repeat(12).trim()}.`).join(' ')

test('groups short paragraphs into cards and tracks verse ranges', () => {
  const raw = `[1] In the beginning.\n\n[2] The earth was without form.\n\n[3] And God said.\n\n[4] And God saw ${'x'.repeat(380)}.`
  const cards = parseChapter(raw)
  assert.equal(cards.length, 2)
  assert.deepEqual([cards[0].v1, cards[0].v2], [1, 3])
  assert.deepEqual([cards[1].v1, cards[1].v2], [4, 4])
})

test('splits an over-long paragraph at verse boundaries and keeps the continuing verse', () => {
  const cards = parseChapter(prose(14))
  assert.ok(cards.length > 1)
  assert.equal(cards[0].v1, 1)
  for (let i = 1; i < cards.length; i++) {
    assert.equal(cards[i].v1, cards[i - 1].v2 + 1)
  }
  assert.equal(cards.at(-1).v2, 14)
})

test('keeps poetry lines together with their indent level', () => {
  const raw = '  [1] Blessed is the man\n    who walks not in the counsel\n  of the wicked,\n\n  [2] but his delight is in the law\n    of the Lord.'
  const [card] = parseChapter(raw)
  assert.equal(card.blocks[0].type, 'poetry')
  assert.deepEqual(card.blocks[0].lines.map(l => l.lvl), [0, 1, 0])
})

test('a verse that continues past a card keeps the previous verse number', () => {
  const cards = parseChapter(`[1] ${'a '.repeat(150)}\n\n[2] short.`)
  assert.equal(cards[0].v1, 1)
})

test('plainText strips verse numbers', () => {
  const [card] = parseChapter('[16] For God so loved the world.')
  assert.equal(plainText(card), 'For God so loved the world.')
})

test('deep links resolve to the longest matching book', () => {
  assert.deepEqual(parseHash('#john-3-16'), { b: 42, c: 3, v: 16 })
  assert.deepEqual(parseHash('#1-john-3'), { b: 61, c: 3, v: 1 })
  assert.deepEqual(parseHash('#song-of-solomon-2-4'), { b: 21, c: 2, v: 4 })
  assert.equal(parseHash('#john-99'), null)
  assert.equal(parseHash('#nonsense'), null)
})

test('chapter navigation crosses book boundaries', () => {
  assert.deepEqual(nextChapter(0, 50), { b: 1, c: 1 })
  assert.deepEqual(prevChapter(1, 1), { b: 0, c: 50 })
  assert.equal(prevChapter(0, 1), null)
  assert.equal(nextChapter(65, 22), null)
})
