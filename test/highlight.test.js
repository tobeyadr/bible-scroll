import test from 'node:test'
import assert from 'node:assert/strict'
import { quoteOf, trimPieces, anchorOf, piecesOf, segmentsOf, contains, sameSpot } from '../public/highlight.js'
import { createState } from '../public/state.js'
import { mergeDocs, emptyDoc, sameDoc } from '../public/merge.js'

const memory = (initial = {}) => {
  const data = new Map(Object.entries(initial))
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }
}

// Three text nodes: verse 1 is "In the beginning" + " God made", verse 2 is "The earth was empty".
const entries = [
  { v: 1, start: 0, len: 16 },
  { v: 1, start: 16, len: 9 },
  { v: 2, start: 0, len: 19 },
]
const texts = ['In the beginning', ' God made', 'The earth was empty']

test('quoteOf joins the words of several nodes as one line', () => {
  assert.equal(quoteOf(['beginning', ' God made']), 'beginning God made')
  assert.equal(quoteOf(['  spaced   out  ', 'words\n here']), 'spaced out words here')
})

test('a selection becomes a position, and the position finds the same words again', () => {
  // from "beginning" (offset 7 of node 0) to "The earth" (offset 9 of node 2)
  const pieces = [
    { i: 0, from: 7, to: 16 },
    { i: 1, from: 0, to: 9 },
    { i: 2, from: 0, to: 9 },
  ]
  const anchor = anchorOf(entries, pieces)
  assert.deepEqual(anchor, { v1: 1, s: 7, v2: 2, e: 9 })
  assert.deepEqual(piecesOf(entries, anchor), pieces)
  assert.equal(quoteOf(pieces.map(p => texts[p.i].slice(p.from, p.to))), 'beginning God made The earth')
})

test('a position inside one node finds just those characters', () => {
  assert.deepEqual(piecesOf(entries, { v1: 1, s: 3, v2: 1, e: 6 }), [{ i: 0, from: 3, to: 6 }])
  // across the join of two nodes in one verse
  assert.deepEqual(piecesOf(entries, { v1: 1, s: 14, v2: 1, e: 20 }), [
    { i: 0, from: 14, to: 16 },
    { i: 1, from: 0, to: 4 },
  ])
  assert.deepEqual(piecesOf(entries, { v1: 2, s: 0, v2: 2, e: 3 }), [{ i: 2, from: 0, to: 3 }])
  assert.deepEqual(piecesOf(entries, { v1: 5, s: 0, v2: 5, e: 3 }), [])
})

test('spaces are trimmed from both ends of a selection', () => {
  const pieces = [
    { i: 1, from: 0, to: 9 },
    { i: 2, from: 0, to: 4 },
  ]
  assert.deepEqual(trimPieces(pieces, texts), [
    { i: 1, from: 1, to: 9 },
    { i: 2, from: 0, to: 3 }, // "The " loses its trailing space
  ])
  assert.deepEqual(trimPieces([{ i: 1, from: 0, to: 1 }], texts), []) // only a space
  assert.deepEqual(trimPieces([{ i: 0, from: 0, to: 3 }, { i: 1, from: 0, to: 1 }], texts), [{ i: 0, from: 0, to: 2 }]) // "In " then " ": both trailing spaces go
})

test('where marks overlap the newest wins, and unmarked runs are kept', () => {
  assert.deepEqual(segmentsOf(10, []), [{ from: 0, to: 10, id: null }])
  assert.deepEqual(segmentsOf(10, [{ from: 2, to: 6, id: 'a' }]), [
    { from: 0, to: 2, id: null },
    { from: 2, to: 6, id: 'a' },
    { from: 6, to: 10, id: null },
  ])
  assert.deepEqual(
    segmentsOf(10, [
      { from: 0, to: 8, id: 'old' },
      { from: 4, to: 6, id: 'new' },
    ]),
    [
      { from: 0, to: 4, id: 'old' },
      { from: 4, to: 6, id: 'new' },
      { from: 6, to: 8, id: 'old' },
      { from: 8, to: 10, id: null },
    ],
  )
})

test('containment and sameness of positions', () => {
  const big = { v1: 1, s: 0, v2: 2, e: 10 }
  assert.ok(contains(big, { v1: 1, s: 5, v2: 1, e: 9 }))
  assert.ok(contains(big, big))
  assert.ok(!contains(big, { v1: 1, s: 0, v2: 2, e: 11 }))
  assert.ok(!contains({ v1: 1, s: 5, v2: 1, e: 9 }, big))
  assert.ok(sameSpot(big, { ...big }))
  assert.ok(!sameSpot(big, { ...big, e: 9 }))
})

const spot = (s, e, extra = {}) => ({ b: 42, c: 1, t: 'BSB', v1: 1, s, v2: 1, e, q: 'x', ...extra })
const tick = () => {
  for (const t = Date.now(); Date.now() === t; );
} // highlights made in one millisecond would tie

test('state: highlights are kept per chapter and translation, oldest first', () => {
  const state = createState(memory())
  const a = state.addHighlight(spot(0, 5, { col: 'green' }))
  tick()
  const b = state.addHighlight(spot(10, 20))
  state.addHighlight(spot(0, 5, { c: 2 }))
  state.addHighlight(spot(0, 5, { t: 'KJV' }))
  const found = state.highlightsFor(42, 1, 'BSB')
  assert.deepEqual(found.map(h => h.id), [a, b])
  assert.equal(found[0].col, 'green')
  assert.equal(found[1].col, 'yellow') // the default
})

test('state: highlighting the same words again changes the colour, not the count', () => {
  const state = createState(memory())
  const a = state.addHighlight(spot(0, 5))
  assert.equal(state.addHighlight(spot(0, 5, { col: 'blue' })), a)
  assert.equal(state.highlightsFor(42, 1, 'BSB').length, 1)
  assert.equal(state.highlightsFor(42, 1, 'BSB')[0].col, 'blue')
  // without a colour (a note on the words) the colour stays
  state.addHighlight(spot(0, 5))
  assert.equal(state.highlightsFor(42, 1, 'BSB')[0].col, 'blue')
})

test('state: a highlight that covers older ones replaces them, a partial overlap does not', () => {
  const state = createState(memory())
  tick()
  state.addHighlight(spot(2, 4))
  tick()
  const partial = state.addHighlight(spot(10, 20))
  tick()
  const wide = state.addHighlight(spot(0, 12))
  const ids = state.highlightsFor(42, 1, 'BSB').map(h => h.id)
  assert.deepEqual(ids.sort(), [partial, wide].sort()) // (2,4) is gone, (10,20) only partly covered
})

test('state: recolouring and removing', () => {
  const state = createState(memory())
  const a = state.addHighlight(spot(0, 5))
  state.setHighlightColor(a, 'pink')
  assert.equal(state.highlightsFor(42, 1, 'BSB')[0].col, 'pink')
  state.removeHighlight(a)
  assert.equal(state.highlightsFor(42, 1, 'BSB').length, 0)
  state.setHighlightColor(a, 'blue') // a removed one stays removed
  assert.equal(state.highlightsFor(42, 1, 'BSB').length, 0)
})

test('state: a note can quote words, and keeps the quote when edited', () => {
  const state = createState(memory())
  const h = state.addHighlight(spot(0, 5))
  const id = state.saveNote({ b: 42, c: 1, v1: 1, v2: 1, text: 'mine', q: 'In the', h })
  assert.equal(state.snapshot().notes[id].q, 'In the')
  assert.equal(state.snapshot().notes[id].h, h)
  state.saveNote({ id, b: 42, c: 1, v1: 1, v2: 1, text: 'edited', q: 'In the', h })
  assert.equal(state.snapshot().notes[id].q, 'In the')
  const plain = state.saveNote({ b: 42, c: 1, v1: 1, v2: 1, text: 'no quote' })
  assert.equal(state.snapshot().notes[plain].q, undefined)
  assert.equal(state.noteList().find(n => n.k === id).q, 'In the')
})

test('merge keeps highlights from two devices and lets a removal spread', () => {
  const mine = { b: 42, c: 1, t: 'BSB', v1: 1, s: 0, v2: 1, e: 5, q: 'In th', col: 'yellow', at: 100, u: 100 }
  const a = { ...emptyDoc(), hl: { x: mine } }
  const b = { ...emptyDoc(), hl: { y: { ...mine, s: 10, e: 15, u: 120, at: 120 } } }
  const both = mergeDocs(a, b, 1000)
  assert.deepEqual(Object.keys(both.hl).sort(), ['x', 'y'])
  assert.ok(sameDoc(both, mergeDocs(b, a, 1000)))

  const removed = { ...emptyDoc(), hl: { x: { u: 200, d: 1 } } }
  assert.equal(mergeDocs(both, removed, 1000).hl.x.d, 1)
  assert.deepEqual(mergeDocs(null, undefined), emptyDoc())
})
