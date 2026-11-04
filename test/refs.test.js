import test from 'node:test'
import assert from 'node:assert/strict'
import { BOOKS } from '../public/books.js'
import { splitRefs } from '../public/refs.js'

// -> [['text', 'John 3:16' or null], ...] with the book, chapter and verse of each link
const linked = text => splitRefs(text).filter(p => p.ref).map(p => [p.t, BOOKS[p.ref.b].n, p.ref.c, p.ref.verse ? p.ref.v : null, p.ref.verse ? p.ref.v2 : null])

test('finds a plain reference inside a sentence and keeps the rest of the text', () => {
  const parts = splitRefs('Compare John 3:16 with this.')
  assert.deepEqual(parts.map(p => p.t), ['Compare ', 'John 3:16', ' with this.'])
  assert.deepEqual(linked('Compare John 3:16 with this.'), [['John 3:16', 'John', 3, 16, 16]])
  assert.equal(parts.map(p => p.t).join(''), 'Compare John 3:16 with this.')
})

test('understands common notation: numbered books, abbreviations, ranges, whole chapters', () => {
  assert.deepEqual(linked('1 Cor 13:4-7'), [['1 Cor 13:4-7', '1 Corinthians', 13, 4, 7]])
  assert.deepEqual(linked('1Cor 13'), [['1Cor 13', '1 Corinthians', 13, null, null]])
  assert.deepEqual(linked('First John 4:8'), [['First John 4:8', '1 John', 4, 8, 8]])
  assert.deepEqual(linked('Ps. 23'), [['Ps. 23', 'Psalms', 23, null, null]])
  assert.deepEqual(linked('Rev 21:1–4'), [['Rev 21:1–4', 'Revelation', 21, 1, 4]])
  assert.deepEqual(linked('Song of Solomon 2:4'), [['Song of Solomon 2:4', 'Song of Solomon', 2, 4, 4]])
  assert.deepEqual(linked('Jude 5'), [['Jude 5', 'Jude', 1, 5, 5]])
  assert.deepEqual(linked('romans 8:28'), [['romans 8:28', 'Romans', 8, 28, 28]])
})

test('any dash between verses makes a range, including the non-breaking hyphen AI answers use', () => {
  assert.deepEqual(linked('John 3:1‑3'), [['John 3:1‑3', 'John', 3, 1, 3]])
  assert.deepEqual(linked('Romans 6:3‐4'), [['Romans 6:3‐4', 'Romans', 6, 3, 4]])
  assert.deepEqual(linked('Acts 2:38—39'), [['Acts 2:38—39', 'Acts', 2, 38, 39]])
  assert.deepEqual(linked('Acts 2:38−39'), [['Acts 2:38−39', 'Acts', 2, 38, 39]])
})

test('finds several references in one note', () => {
  assert.deepEqual(linked('John 3:16 echoes Romans 5:8; see also Eph 2:8-9.'), [
    ['John 3:16', 'John', 3, 16, 16],
    ['Romans 5:8', 'Romans', 5, 8, 8],
    ['Eph 2:8-9', 'Ephesians', 2, 8, 9],
  ])
})

test('a numbered book is found even right after a word and a number-like word', () => {
  assert.deepEqual(linked('Compare John 3:16 and 1 Cor 13:4-7'), [
    ['John 3:16', 'John', 3, 16, 16],
    ['1 Cor 13:4-7', '1 Corinthians', 13, 4, 7],
  ])
  assert.deepEqual(linked('see 2 Tim 3:16 or and 1 John 4:8'), [
    ['2 Tim 3:16', '2 Timothy', 3, 16, 16],
    ['1 John 4:8', '1 John', 4, 8, 8],
  ])
})

test('copes with words in front of the book name', () => {
  assert.deepEqual(linked('the book of John 3:16'), [['John 3:16', 'John', 3, 16, 16]])
  assert.deepEqual(linked('see Matthew 5:3'), [['Matthew 5:3', 'Matthew', 5, 3, 3]])
})

test('does not link things that are not references', () => {
  assert.deepEqual(linked('I have 3 reasons and 16 more'), [])
  assert.deepEqual(linked('John said hello'), [])
  assert.deepEqual(linked('Chapter 3 of the plan, at 5:30'), [])
  assert.deepEqual(linked('John 400:1'), []) // no such chapter
  assert.deepEqual(linked(''), [])
})

test('splitting loses no text', () => {
  const text = 'Notes: 1 John 4:8, Ps 23 and "John 3:16-18" (v. 5).'
  assert.equal(splitRefs(text).map(p => p.t).join(''), text)
})
