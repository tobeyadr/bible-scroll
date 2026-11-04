// Turns the ESV API's plain-text chapter into short "cards" that each fit one screen.
//
// Input shape (line-length=0, verse numbers on): paragraphs separated by blank lines, prose on a
// single line, poetry as several indented lines, verse numbers as "[12]".

const SOFT = 420 // start a new card once adding the next block would pass this
const HARD = 520 // a single block longer than this is split at verse boundaries
const PIECE = 380 // target size of the pieces a long block is split into

const VERSE = /\[(\d+)\]/g

const len = block => block.lines.reduce((n, l) => n + l.t.length, 0)

function splitProse(text) {
  const parts = text.split(/(?=\[\d+\])/).filter(Boolean)
  const pieces = []
  let cur = ''
  for (const p of parts) {
    if (cur && cur.length + p.length > PIECE) {
      pieces.push(cur)
      cur = ''
    }
    cur += p
  }
  if (cur) pieces.push(cur)
  return pieces
}

function splitPoetry(lines) {
  const groups = []
  let cur = []
  let n = 0
  for (const l of lines) {
    if (cur.length && n >= PIECE && /^\[\d+\]/.test(l.t)) {
      groups.push(cur)
      cur = []
      n = 0
    }
    cur.push(l)
    n += l.t.length
  }
  if (cur.length) groups.push(cur)
  return groups
}

function toBlocks(raw) {
  const blocks = []
  const text = raw.replace(/\r/g, '').replace(/^\n+/, '').trimEnd()
  for (const chunk of text.split(/\n[ \t]*\n/)) {
    const rows = chunk.split('\n').filter(l => l.trim())
    if (!rows.length) continue

    if (rows.length === 1) {
      const t = rows[0].trim().replace(/\s+/g, ' ')
      const prose = { type: 'prose', cont: false, lines: [{ t, lvl: 0 }] }
      if (t.length <= HARD) {
        blocks.push(prose)
      } else {
        splitProse(t).forEach((piece, i) =>
          blocks.push({ type: 'prose', cont: i > 0, lines: [{ t: piece.trim(), lvl: 0 }] }),
        )
      }
      continue
    }

    const indents = rows.map(r => r.match(/^ */)[0].length)
    const min = Math.min(...indents)
    const lines = rows.map((r, i) => ({
      t: r.trim().replace(/\s+/g, ' '),
      lvl: Math.min(3, Math.round((indents[i] - min) / 2)),
    }))
    const poem = { type: 'poetry', cont: false, lines }
    if (len(poem) <= HARD) {
      blocks.push(poem)
    } else {
      splitPoetry(lines).forEach((group, i) => blocks.push({ type: 'poetry', cont: i > 0, lines: group }))
    }
  }
  return blocks
}

export function parseChapter(raw) {
  const cards = []
  let cur = []
  let n = 0
  for (const block of toBlocks(raw)) {
    const l = len(block)
    if (cur.length && n + l > SOFT) {
      cards.push({ blocks: cur })
      cur = []
      n = 0
    }
    cur.push(block)
    n += l
  }
  if (cur.length) cards.push({ blocks: cur })

  // Work out which verses each card covers; a card that opens mid-verse continues the last one.
  let cursor = 1
  for (const card of cards) {
    const nums = []
    let opensWithMarker = false
    card.blocks.forEach((b, bi) =>
      b.lines.forEach((line, li) => {
        if (bi === 0 && li === 0) opensWithMarker = /^\[\d+\]/.test(line.t)
        for (const m of line.t.matchAll(VERSE)) nums.push(Number(m[1]))
      }),
    )
    card.v1 = opensWithMarker || !nums.length ? (nums[0] ?? cursor) : cursor
    card.v2 = nums.length ? nums[nums.length - 1] : card.v1
    cursor = card.v2
  }
  return cards
}

export const plainText = card =>
  card.blocks
    .map(b => b.lines.map(l => l.t).join('\n'))
    .join('\n\n')
    .replace(/\[\d+\]\s*/g, '')
