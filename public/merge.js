// The personal data that follows her between devices, and how two copies of it are combined.
//
//   { v: 1,
//     saved: { "<card key>": { b, c, v1, v2, u, d? } },
//     notes: { "<id>":       { b, c, v1, v2, text, at, u, d? } },
//     pos:   { b, c, v, u } | null }
//
// u is the time of the last edit. For each item the newest edit wins; d marks a deletion so that it
// spreads to the other device instead of the item coming back. Merging is commutative and idempotent,
// so devices converge no matter what order they sync in.

export const TOMBSTONE_TTL = 180 * 24 * 60 * 60 * 1000

export const emptyDoc = () => ({ v: 1, saved: {}, notes: {}, pos: null })

const isObject = x => x && typeof x === 'object' && !Array.isArray(x)

export function normalizeDoc(doc) {
  return {
    v: 1,
    saved: isObject(doc?.saved) ? doc.saved : {},
    notes: isObject(doc?.notes) ? doc.notes : {},
    pos: isObject(doc?.pos) ? doc.pos : null,
  }
}

// Keys sorted so equal documents always serialise identically.
export function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canon(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function newest(a, b) {
  if (!a) return b
  if (!b) return a
  if (a.u !== b.u) return a.u > b.u ? a : b
  return canon(a) >= canon(b) ? a : b
}

function mergeMaps(a, b, now) {
  const out = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const item = newest(a[key], b[key])
    if (item.d && now - item.u > TOMBSTONE_TTL) continue
    out[key] = item
  }
  return out
}

export function mergeDocs(a, b, now = Date.now()) {
  const x = normalizeDoc(a)
  const y = normalizeDoc(b)
  return {
    v: 1,
    saved: mergeMaps(x.saved, y.saved, now),
    notes: mergeMaps(x.notes, y.notes, now),
    pos: newest(x.pos, y.pos),
  }
}

export const sameDoc = (a, b) => canon(normalizeDoc(a)) === canon(normalizeDoc(b))
