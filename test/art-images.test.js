import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BOOKS, slug } from '../public/books.js'
import { parseArtRef, compileArt, pickArt } from '../public/art.js'

const set = JSON.parse(readFileSync(new URL('../art/images.json', import.meta.url), 'utf8'))
const verseCount = (b, c) => {
  const raw = JSON.parse(readFileSync(new URL(`../public/bsb/${b}.json`, import.meta.url)))[c - 1]
  return Math.max(...[...raw.matchAll(/\[(\d+)\]/g)].map(m => +m[1]))
}
const decode = key => ({ b: Math.floor(key / 1e6), c: Math.floor((key % 1e6) / 1e3), v: key % 1e3 })

test('the set has a style, a size and uniquely named images with prompts and passages', () => {
  assert.ok(set.style.length > 200, 'style')
  assert.deepEqual(set.size, { width: 1024, height: 1536 })
  const ids = set.images.map(i => i.id)
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')
  for (const image of set.images) {
    assert.match(image.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${image.id} is a plain file name`)
    assert.ok(image.prompt.length > 40 && image.prompt.length < 600, `${image.id} prompt length`)
    assert.ok(Array.isArray(image.refs) && image.refs.length, `${image.id} has passages`)
  }
})

test('every book has a picture of its own, named for it', () => {
  BOOKS.forEach(book => {
    const image = set.images.find(i => i.id === `book-${slug(BOOKS.indexOf(book))}`)
    assert.ok(image, `${book.n} has a book picture`)
    assert.deepEqual(image.refs, [book.n], `${book.n} picture covers the whole book`)
  })
  assert.equal(set.images.filter(i => i.id.startsWith('book-')).length, BOOKS.length)
})

test('every passage is a real place in the Bible, and the verses exist', () => {
  for (const image of set.images) {
    for (const ref of image.refs) {
      const range = parseArtRef(ref)
      assert.ok(range, `${image.id}: "${ref}" is not a passage`)
      const from = decode(range.from)
      const to = decode(range.to)
      assert.ok(from.v <= verseCount(from.b, from.c), `${image.id}: "${ref}" starts after the last verse of the chapter`)
      if (to.v !== 999) assert.ok(to.v <= verseCount(to.b, to.c), `${image.id}: "${ref}" ends after the last verse of the chapter`)
    }
  }
})

test('no passage is given to two pictures', () => {
  const seen = new Map()
  for (const image of set.images) {
    for (const ref of image.refs) {
      assert.ok(!seen.has(ref), `"${ref}" is in both ${seen.get(ref)} and ${image.id}`)
      seen.set(ref, image.id)
    }
  }
})

test('moments sit inside their book, and every one of them wins over the book picture', () => {
  const entries = compileArt({ art: set.images.flatMap(i => i.refs.map(ref => ({ ref, img: i.id }))) })
  for (const image of set.images.filter(i => !i.id.startsWith('book-'))) {
    for (const ref of image.refs) {
      const { from } = parseArtRef(ref)
      const { b, c, v } = decode(from)
      assert.equal(pickArt(entries, b, c, v), image.id, `${ref} should show ${image.id}`)
    }
  }
})

test('a first batch is marked, covering different kinds of picture', () => {
  const pilot = set.images.filter(i => i.pilot)
  assert.ok(pilot.length >= 6 && pilot.length <= 12, `${pilot.length} pilot pictures`)
  assert.ok(pilot.some(i => i.id.startsWith('book-')) && pilot.some(i => !i.id.startsWith('book-')))
})
