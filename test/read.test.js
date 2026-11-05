import test from 'node:test'
import assert from 'node:assert/strict'
import { BOOKS } from '../public/books.js'
import {
  WHOLE,
  readKey,
  normalizeRanges,
  addRange,
  hasRange,
  chapterStatus,
  chapterFraction,
  bookProgress,
  mergeRead,
} from '../public/read.js'
import { mergeDocs, emptyDoc, sameDoc, normalizeDoc, TOMBSTONE_TTL } from '../public/merge.js'
import { createState } from '../public/state.js'

const memory = () => {
  const data = new Map()
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }
}
const doc = read => ({ ...emptyDoc(), read })
const john = BOOKS.findIndex(b => b.n === 'John')

test('ranges are sorted, joined when they touch, and junk is dropped', () => {
  assert.deepEqual(normalizeRanges([[9, 12], [1, 5], [6, 6], [11, 20]]), [[1, 6], [9, 20]])
  assert.deepEqual(normalizeRanges([[1, 3], [5, 6]]), [[1, 3], [5, 6]])
  assert.deepEqual(normalizeRanges([[0, 3], [4, 2], ['a', 1], null, [2.5, 3], [1, 1000]]), [])
  assert.deepEqual(normalizeRanges('nope'), [])
  assert.deepEqual(addRange([[1, 5]], 7, 9), [[1, 5], [7, 9]])
  assert.deepEqual(addRange(undefined, 3, 3), [[3, 3]])
})

test('a passage is read only when every one of its verses is', () => {
  const r = [[1, 5], [8, 12]]
  assert.ok(hasRange(r, 2, 5))
  assert.ok(hasRange(r, 8, 8))
  assert.ok(!hasRange(r, 5, 8), 'verses 6 and 7 are missing')
  assert.ok(!hasRange(r, 12, 13))
  assert.ok(!hasRange(undefined, 1, 1))
})

test('a chapter is read when all of it is, started when some is', () => {
  assert.equal(chapterStatus(undefined), 'none')
  assert.equal(chapterStatus({ r: [] }), 'none')
  assert.equal(chapterStatus({ r: [[1, 5]], n: 31 }), 'part')
  assert.equal(chapterStatus({ r: [[1, 20], [22, 31]], n: 31 }), 'part')
  assert.equal(chapterStatus({ r: [[1, 31]], n: 31 }), 'read')
  assert.equal(chapterStatus({ r: [[1, 5]] }), 'part', 'without its length it cannot be called read')
  assert.equal(chapterStatus({ r: [[1, WHOLE]], n: 0 }), 'read', 'marked read by hand')
  assert.equal(chapterFraction({ r: [[1, 10]], n: 40 }), 0.25)
  assert.equal(chapterFraction({ r: [[1, 40]], n: 40 }), 1)
  assert.equal(chapterFraction(undefined), 0)
})

test('book progress counts chapters read and started', () => {
  const read = {
    [readKey(john, 1)]: { r: [[1, 51]], n: 51, u: 1 },
    [readKey(john, 2)]: { r: [[1, 25]], n: 25, u: 1 },
    [readKey(john, 3)]: { r: [[1, 10]], n: 36, u: 1 },
  }
  const p = bookProgress(read, john, BOOKS[john].c)
  assert.equal(p.done, 2)
  assert.equal(p.started, 1)
  assert.equal(p.chapters, 21)
  assert.ok(p.fraction > 2 / 21 && p.fraction < 3 / 21)
  assert.deepEqual(bookProgress({}, john, 21), { done: 0, started: 0, chapters: 21, fraction: 0 })
})

test('two devices that read different verses of a chapter keep both', () => {
  const a = { r: [[1, 10]], n: 31, u: 100 }
  const b = { r: [[20, 31]], n: 31, u: 200 }
  assert.deepEqual(mergeRead(a, b).r, [[1, 10], [20, 31]])
  assert.deepEqual(mergeRead(b, a), mergeRead(a, b))
})

test('clearing a chapter spreads, but reading after the clear is kept', () => {
  const read = { r: [[1, 10]], n: 31, u: 100 }
  const cleared = { r: [], n: 31, u: 200, z: 200 }
  assert.deepEqual(mergeRead(read, cleared).r, [], 'the old reading is forgotten')
  const again = { r: [[3, 4]], n: 31, u: 300, z: 200 }
  assert.deepEqual(mergeRead(mergeRead(read, cleared), again).r, [[3, 4]])
  assert.deepEqual(mergeRead(read, mergeRead(cleared, again)).r, [[3, 4]], 'the order of merging does not matter')
})

test('merging documents is order independent and repeatable, and old documents still load', () => {
  const k = readKey(john, 3)
  const a = doc({ [k]: { r: [[1, 10]], n: 36, u: 100 }, [readKey(john, 4)]: { r: [[1, 54]], n: 54, u: 100 } })
  const b = doc({ [k]: { r: [[11, 20]], n: 36, u: 150 } })
  const ab = mergeDocs(a, b, 1000)
  assert.deepEqual(ab.read[k].r, [[1, 20]])
  assert.ok(sameDoc(ab, mergeDocs(b, a, 1000)))
  assert.ok(sameDoc(ab, mergeDocs(ab, a, 1000)))
  assert.ok(sameDoc(ab, mergeDocs(ab, ab, 1000)))
  assert.deepEqual(normalizeDoc({ saved: {}, notes: {}, pos: null }).read, {})
  assert.deepEqual(mergeDocs(null, undefined), emptyDoc())
})

test('a chapter cleared long ago and not read since is forgotten', () => {
  const cleared = doc({ '0.1': { r: [], n: 31, u: 100, z: 100 } })
  assert.deepEqual(mergeDocs(cleared, emptyDoc(), 100 + TOMBSTONE_TTL + 1).read, {})
  assert.ok(mergeDocs(cleared, emptyDoc(), 100 + TOMBSTONE_TTL - 1).read['0.1'])
})

test('the state records reading, counts it by verse, and only reports what is new', () => {
  const state = createState(memory())
  let commits = 0
  state.onChange(() => commits++)

  assert.ok(!state.hasRead(john, 3, 1, 5))
  assert.equal(state.markRead(john, 3, 1, 5, 36), true)
  assert.equal(state.markRead(john, 3, 1, 5, 36), false, 'nothing new, nothing written')
  assert.equal(commits, 1)
  assert.ok(state.hasRead(john, 3, 2, 4))
  assert.ok(!state.hasRead(john, 3, 4, 8))
  assert.equal(chapterStatus(state.readEntry(john, 3)), 'part')

  state.markRead(john, 3, 6, 36, 36)
  assert.equal(chapterStatus(state.readEntry(john, 3)), 'read')
  assert.deepEqual(state.readEntry(john, 3).r, [[1, 36]])
})

test('marking a book read, and clearing it, work from the state', () => {
  const state = createState(memory())
  state.markRead(john, 1, 1, 10, 51)
  state.markBookRead(john)
  const p = bookProgress(state.readMap(), john, BOOKS[john].c)
  assert.equal(p.done, 21)

  state.markRead(0, 1, 1, 3, 31)
  state.clearRead(john)
  assert.equal(bookProgress(state.readMap(), john, 21).done, 0)
  assert.equal(state.hasRead(john, 1, 1, 10), false)
  assert.equal(state.hasRead(0, 1, 1, 3), true, 'other books are not touched')

  state.markRead(john, 1, 1, 5, 51)
  assert.ok(state.hasRead(john, 1, 1, 5), 'reading again after a clear counts')
  state.clearRead()
  assert.equal(state.hasRead(0, 1, 1, 3), false)
})

test('reading survives a restart and a sync merge from another device', () => {
  const storage = memory()
  createState(storage).markRead(john, 3, 1, 15, 36)
  const state = createState(storage)
  assert.ok(state.hasRead(john, 3, 1, 15))

  const other = createState(memory())
  other.markRead(john, 3, 16, 36, 36)
  state.applyRemote(mergeDocs(state.snapshot(), other.snapshot()))
  assert.equal(chapterStatus(state.readEntry(john, 3)), 'read')
})
