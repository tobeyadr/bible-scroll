// n = display name, q = name the ESV API understands, c = chapter count, g = group index into HUES
export const BOOKS = [
  { n: 'Genesis', q: 'Genesis', c: 50, g: 0 },
  { n: 'Exodus', q: 'Exodus', c: 40, g: 0 },
  { n: 'Leviticus', q: 'Leviticus', c: 27, g: 0 },
  { n: 'Numbers', q: 'Numbers', c: 36, g: 0 },
  { n: 'Deuteronomy', q: 'Deuteronomy', c: 34, g: 0 },
  { n: 'Joshua', q: 'Joshua', c: 24, g: 1 },
  { n: 'Judges', q: 'Judges', c: 21, g: 1 },
  { n: 'Ruth', q: 'Ruth', c: 4, g: 1 },
  { n: '1 Samuel', q: '1 Samuel', c: 31, g: 1 },
  { n: '2 Samuel', q: '2 Samuel', c: 24, g: 1 },
  { n: '1 Kings', q: '1 Kings', c: 22, g: 1 },
  { n: '2 Kings', q: '2 Kings', c: 25, g: 1 },
  { n: '1 Chronicles', q: '1 Chronicles', c: 29, g: 1 },
  { n: '2 Chronicles', q: '2 Chronicles', c: 36, g: 1 },
  { n: 'Ezra', q: 'Ezra', c: 10, g: 1 },
  { n: 'Nehemiah', q: 'Nehemiah', c: 13, g: 1 },
  { n: 'Esther', q: 'Esther', c: 10, g: 1 },
  { n: 'Job', q: 'Job', c: 42, g: 2 },
  { n: 'Psalms', q: 'Psalm', c: 150, g: 2 },
  { n: 'Proverbs', q: 'Proverbs', c: 31, g: 2 },
  { n: 'Ecclesiastes', q: 'Ecclesiastes', c: 12, g: 2 },
  { n: 'Song of Solomon', q: 'Song of Solomon', c: 8, g: 2 },
  { n: 'Isaiah', q: 'Isaiah', c: 66, g: 3 },
  { n: 'Jeremiah', q: 'Jeremiah', c: 52, g: 3 },
  { n: 'Lamentations', q: 'Lamentations', c: 5, g: 3 },
  { n: 'Ezekiel', q: 'Ezekiel', c: 48, g: 3 },
  { n: 'Daniel', q: 'Daniel', c: 12, g: 3 },
  { n: 'Hosea', q: 'Hosea', c: 14, g: 4 },
  { n: 'Joel', q: 'Joel', c: 3, g: 4 },
  { n: 'Amos', q: 'Amos', c: 9, g: 4 },
  { n: 'Obadiah', q: 'Obadiah', c: 1, g: 4 },
  { n: 'Jonah', q: 'Jonah', c: 4, g: 4 },
  { n: 'Micah', q: 'Micah', c: 7, g: 4 },
  { n: 'Nahum', q: 'Nahum', c: 3, g: 4 },
  { n: 'Habakkuk', q: 'Habakkuk', c: 3, g: 4 },
  { n: 'Zephaniah', q: 'Zephaniah', c: 3, g: 4 },
  { n: 'Haggai', q: 'Haggai', c: 2, g: 4 },
  { n: 'Zechariah', q: 'Zechariah', c: 14, g: 4 },
  { n: 'Malachi', q: 'Malachi', c: 4, g: 4 },
  { n: 'Matthew', q: 'Matthew', c: 28, g: 5 },
  { n: 'Mark', q: 'Mark', c: 16, g: 5 },
  { n: 'Luke', q: 'Luke', c: 24, g: 5 },
  { n: 'John', q: 'John', c: 21, g: 5 },
  { n: 'Acts', q: 'Acts', c: 28, g: 6 },
  { n: 'Romans', q: 'Romans', c: 16, g: 7 },
  { n: '1 Corinthians', q: '1 Corinthians', c: 16, g: 7 },
  { n: '2 Corinthians', q: '2 Corinthians', c: 13, g: 7 },
  { n: 'Galatians', q: 'Galatians', c: 6, g: 7 },
  { n: 'Ephesians', q: 'Ephesians', c: 6, g: 7 },
  { n: 'Philippians', q: 'Philippians', c: 4, g: 7 },
  { n: 'Colossians', q: 'Colossians', c: 4, g: 7 },
  { n: '1 Thessalonians', q: '1 Thessalonians', c: 5, g: 7 },
  { n: '2 Thessalonians', q: '2 Thessalonians', c: 3, g: 7 },
  { n: '1 Timothy', q: '1 Timothy', c: 6, g: 7 },
  { n: '2 Timothy', q: '2 Timothy', c: 4, g: 7 },
  { n: 'Titus', q: 'Titus', c: 3, g: 7 },
  { n: 'Philemon', q: 'Philemon', c: 1, g: 7 },
  { n: 'Hebrews', q: 'Hebrews', c: 13, g: 7 },
  { n: 'James', q: 'James', c: 5, g: 7 },
  { n: '1 Peter', q: '1 Peter', c: 5, g: 7 },
  { n: '2 Peter', q: '2 Peter', c: 3, g: 7 },
  { n: '1 John', q: '1 John', c: 5, g: 7 },
  { n: '2 John', q: '2 John', c: 1, g: 7 },
  { n: '3 John', q: '3 John', c: 1, g: 7 },
  { n: 'Jude', q: 'Jude', c: 1, g: 7 },
  { n: 'Revelation', q: 'Revelation', c: 22, g: 8 },
]

export const OT_COUNT = 39

// Law, history, wisdom, major prophets, minor prophets, gospels, acts, epistles, revelation
export const HUES = [28, 200, 160, 262, 340, 45, 18, 220, 300]

export const slug = b => BOOKS[b].n.toLowerCase().replace(/\s+/g, '-')

export function nextChapter(b, c) {
  if (c < BOOKS[b].c) return { b, c: c + 1 }
  return b + 1 < BOOKS.length ? { b: b + 1, c: 1 } : null
}

export function prevChapter(b, c) {
  if (c > 1) return { b, c: c - 1 }
  return b > 0 ? { b: b - 1, c: BOOKS[b - 1].c } : null
}

export function refLabel(b, c, v1, v2) {
  const base = `${BOOKS[b].n} ${c}`
  if (v1 == null) return base
  return v2 == null || v2 === v1 ? `${base}:${v1}` : `${base}:${v1}–${v2}`
}

// "#john-3-16" or "#1-john-3" -> { b, c, v }
export function parseHash(hash) {
  const h = hash.replace(/^#/, '').toLowerCase()
  let best = -1
  for (let i = 0; i < BOOKS.length; i++) {
    if (h.startsWith(slug(i) + '-') && (best < 0 || slug(i).length > slug(best).length)) best = i
  }
  if (best < 0) return null
  const m = h.slice(slug(best).length + 1).match(/^(\d+)(?:-(\d+))?$/)
  if (!m) return null
  const c = Number(m[1])
  if (c < 1 || c > BOOKS[best].c) return null
  return { b: best, c, v: m[2] ? Number(m[2]) : 1 }
}
