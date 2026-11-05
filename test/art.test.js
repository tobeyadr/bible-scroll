import test from 'node:test'
import assert from 'node:assert/strict'
import { BOOKS } from '../public/books.js'
import { parseArtRef, compileArt, pickArt, artUrl } from '../public/art.js'

const book = name => BOOKS.findIndex(b => b.n === name)
const at = (entries, name, c, v) => pickArt(compileArt({ art: entries }), book(name), c, v)

test('refs are books, chapters, chapter runs, verses, verse runs and runs across chapters', () => {
  const span = ref => {
    const r = parseArtRef(ref)
    return r && [Math.floor(r.from / 1e6), Math.floor((r.from % 1e6) / 1e3), r.from % 1e3, Math.floor((r.to % 1e6) / 1e3), r.to % 1e3]
  }
  assert.deepEqual(span('Genesis'), [0, 1, 1, 50, 999])
  assert.deepEqual(span('Genesis 7'), [0, 7, 1, 7, 999])
  assert.deepEqual(span('Matthew 5-7'), [39, 5, 1, 7, 999])
  assert.deepEqual(span('John 3:16'), [42, 3, 16, 3, 16])
  assert.deepEqual(span('Genesis 11:1-9'), [0, 11, 1, 11, 9])
  assert.deepEqual(span('Genesis 6:9–9:17'), [0, 6, 9, 9, 17], 'an en dash is fine')
  assert.deepEqual(span('Genesis 6:9 - 9:17'), [0, 6, 9, 9, 17], 'and so are spaces')
})

test('names are matched whole, so John, 1 John and Judges do not run into each other', () => {
  assert.equal(Math.floor(parseArtRef('1 John 3').from / 1e6), book('1 John'))
  assert.equal(Math.floor(parseArtRef('John 3').from / 1e6), book('John'))
  assert.equal(Math.floor(parseArtRef('Judges 3').from / 1e6), book('Judges'))
  assert.equal(Math.floor(parseArtRef('Jude').from / 1e6), book('Jude'))
  assert.equal(Math.floor(parseArtRef('Song of Solomon 2').from / 1e6), book('Song of Solomon'))
})

test('refs that are not real places are refused', () => {
  for (const bad of ['', 'Genesis 51', 'Genesis 0', 'Genesis 3:0', 'Genesis 9-3', 'Genesis 3:9-3:2', 'Gen 1', 'Genesis one', 'Atlantis 1', 'John 3:16-', '3:16']) {
    assert.equal(parseArtRef(bad), null, `"${bad}"`)
  }
})

test('a book picture is the default and anything narrower overrides it', () => {
  const entries = [
    { ref: 'Matthew', img: 'book-matthew.webp' },
    { ref: 'Matthew 14', img: 'chapter-14.webp' },
    { ref: 'Matthew 14:22-33', img: 'walks-on-water.webp' },
  ]
  assert.equal(at(entries, 'Matthew', 2, 1), 'book-matthew.webp')
  assert.equal(at(entries, 'Matthew', 14, 1), 'chapter-14.webp')
  assert.equal(at(entries, 'Matthew', 14, 21), 'chapter-14.webp')
  assert.equal(at(entries, 'Matthew', 14, 22), 'walks-on-water.webp')
  assert.equal(at(entries, 'Matthew', 14, 33), 'walks-on-water.webp')
  assert.equal(at(entries, 'Matthew', 14, 34), 'chapter-14.webp')
  assert.equal(at(entries, 'Matthew', 15, 1), 'book-matthew.webp')
})

test('the order in the list does not matter, only how narrow the range is', () => {
  const narrow = { ref: 'Genesis 11:1-9', img: 'babel.webp' }
  const wide = { ref: 'Genesis', img: 'genesis.webp' }
  assert.equal(at([narrow, wide], 'Genesis', 11, 5), 'babel.webp')
  assert.equal(at([wide, narrow], 'Genesis', 11, 5), 'babel.webp')
})

test('a run across chapters covers every verse in it, and nothing outside', () => {
  const entries = [
    { ref: 'Genesis', img: 'genesis.webp' },
    { ref: 'Genesis 6:9-9:17', img: 'noah.webp' },
  ]
  assert.equal(at(entries, 'Genesis', 6, 8), 'genesis.webp')
  assert.equal(at(entries, 'Genesis', 6, 9), 'noah.webp')
  assert.equal(at(entries, 'Genesis', 8, 1), 'noah.webp')
  assert.equal(at(entries, 'Genesis', 9, 17), 'noah.webp')
  assert.equal(at(entries, 'Genesis', 9, 18), 'genesis.webp')
})

test('a narrower run inside a wider one wins, and the wider one shows around it', () => {
  const entries = [
    { ref: 'Genesis 6:9-9:17', img: 'noah.webp' },
    { ref: 'Genesis 7:1-24', img: 'flood.webp' },
    { ref: 'Genesis 8:1-19', img: 'dove.webp' },
  ]
  assert.equal(at(entries, 'Genesis', 6, 22), 'noah.webp')
  assert.equal(at(entries, 'Genesis', 7, 10), 'flood.webp')
  assert.equal(at(entries, 'Genesis', 8, 20), 'noah.webp')
  assert.equal(at(entries, 'Genesis', 8, 3), 'dove.webp')
})

test('two entries of the same size: the later one wins', () => {
  const entries = [
    { ref: 'John 3:16', img: 'a.webp' },
    { ref: 'John 3:16', img: 'b.webp' },
  ]
  assert.equal(at(entries, 'John', 3, 16), 'b.webp')
})

test('nothing matches, nothing is returned', () => {
  assert.equal(at([{ ref: 'Genesis', img: 'g.webp' }], 'Exodus', 1, 1), null)
  assert.equal(pickArt([], 0, 1, 1), null)
})

test('a manifest with bad entries, or none, is still usable', () => {
  const compiled = compileArt({ art: [{ ref: 'Atlantis 1', img: 'x.webp' }, { ref: 'Genesis' }, null, { ref: 'Genesis 1', img: 'ok.webp?v=1' }] })
  assert.equal(compiled.length, 1)
  assert.equal(pickArt(compiled, 0, 1, 1), 'ok.webp?v=1')
  assert.deepEqual(compileArt(null), [])
  assert.deepEqual(compileArt({}), [])
})

test('the picture url keeps a version query, which is how a redone picture gets past the cache', () => {
  assert.equal(artUrl('book-john', 3), '/api/art/book-john?v=3')
  assert.equal(artUrl('book-john'), '/api/art/book-john?v=0')
})
