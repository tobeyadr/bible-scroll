// What she has read. Reading is recorded per chapter as the verse ranges that have been on screen long enough, so the
// same record answers "has this passage been read?", "how much of this chapter?" and "which chapters of this book?".
//
//   read: { "<book>.<chapter>": { r: [[1, 5], [9, 12]], n: 31, u, z? } }
//
// r is the verses read (sorted, merged), n the number of verses the chapter has (the most any translation showed),
// u the time of the last change, and z the time the chapter was last cleared. Pure functions, so they can be tested
// without a browser; merge.js uses them to combine two devices' records.

export const WHOLE = 999 // "all of it", for a chapter marked read by hand without opening it

export const readKey = (b, c) => `${b}.${c}`

const whole = x => Number.isInteger(x) && x >= 1 && x <= WHOLE

// Sorted, overlapping or touching ranges joined, anything that is not a range dropped.
export function normalizeRanges(ranges) {
  const list = (Array.isArray(ranges) ? ranges : [])
    .filter(r => Array.isArray(r) && whole(r[0]) && whole(r[1]) && r[0] <= r[1])
    .map(r => [r[0], r[1]])
    .sort((a, b) => a[0] - b[0])
  const out = []
  for (const r of list) {
    const last = out.at(-1)
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push(r)
  }
  return out
}

export const addRange = (ranges, v1, v2) => normalizeRanges([...(ranges ?? []), [v1, v2]])

export const unionRanges = (a, b) => normalizeRanges([...(a ?? []), ...(b ?? [])])

export const sameRanges = (a, b) => JSON.stringify(normalizeRanges(a)) === JSON.stringify(normalizeRanges(b))

// Whether every verse from v1 to v2 is inside the ranges.
export const hasRange = (ranges, v1, v2) => normalizeRanges(ranges).some(r => r[0] <= v1 && v2 <= r[1])

// How many verses the ranges hold (a chapter marked read by hand counts as all of it).
const countOf = ranges => normalizeRanges(ranges).reduce((sum, r) => sum + (r[1] - r[0] + 1), 0)

// 'read' when the whole chapter is covered, 'part' when some of it is, otherwise 'none'.
export function chapterStatus(entry) {
  const r = normalizeRanges(entry?.r)
  if (!r.length) return 'none'
  const n = Number(entry.n) || 0
  const covered = r.length === 1 && r[0][0] === 1 && (r[0][1] >= WHOLE || (n > 0 && r[0][1] >= n))
  return covered ? 'read' : 'part'
}

// Share of a chapter that is read, 0 to 1 (only meaningful when its length is known).
export function chapterFraction(entry) {
  const status = chapterStatus(entry)
  if (status !== 'part') return status === 'read' ? 1 : 0
  const n = Number(entry.n) || 0
  return n ? Math.min(1, countOf(entry.r) / n) : 0.5
}

// For one book: how many of its chapters are read all the way through, and how many have been started.
// `fraction` (0 to 1) also counts the part of each started chapter that is read.
export function bookProgress(read, b, chapters) {
  let done = 0
  let started = 0
  let sum = 0
  for (let c = 1; c <= chapters; c++) {
    const entry = read?.[readKey(b, c)]
    const status = chapterStatus(entry)
    if (status === 'read') done++
    else if (status === 'part') started++
    sum += chapterFraction(entry)
  }
  return { done, started, chapters, fraction: chapters ? sum / chapters : 0 }
}

// The two chapter records of one chapter, from two devices, as one. Verses read are only ever added, except that a
// chapter cleared at z drops what a side had read by then (a side that read again after z keeps its reading).
export function mergeRead(a, b) {
  if (!a || !b) {
    const only = a || b
    return only && { ...only, r: normalizeRanges(only.r) }
  }
  const z = Math.max(a.z || 0, b.z || 0)
  const kept = [a, b].filter(side => (side.u || 0) > z)
  const out = {
    r: kept.reduce((all, side) => unionRanges(all, side.r), []),
    n: Math.max(a.n || 0, b.n || 0),
    u: Math.max(a.u || 0, b.u || 0),
  }
  if (z) out.z = z
  return out
}
