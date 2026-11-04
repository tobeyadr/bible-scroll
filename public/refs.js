// Finds scripture references ("John 3:16", "1 Cor 13:4-7", "Ps 23", "Jude 5") in free text, so notes can link them.

import { parseReference } from './search.js'

// [1-3 or First/Second/Third] book name [of Word] chapter [:verse [-verse]]
const REF = /(?<![\p{L}\p{N}])(?:([1-3]|first|second|third)\.?\s*)?([a-z]{2,}\.?(?:\s+of\s+[a-z]+)?)\s*(\d{1,3})(?:\s*:\s*(\d{1,3})(?:\s*[-‐-―−]\s*(\d{1,3}))?)?(?![\p{L}\p{N}])/giu
const ORDINAL = { first: '1', second: '2', third: '3' }

function tryParse(lead, name, chapter, verse, end) {
  const num = lead ? ORDINAL[lead.toLowerCase()] || lead : ''
  const tail = verse && +verse > 0 ? `:${verse}${end ? `-${end}` : ''}` : ''
  return parseReference(`${num} ${name} ${chapter}${tail}`)
}

// "Read John 3:16 and Ps 23." -> [{ t: 'Read ' }, { t: 'John 3:16', ref }, { t: ' and ' }, { t: 'Ps 23', ref }, { t: '.' }]
// `ref` is { b, c, v, v2, verse } from parseReference. Text that is not a reference comes back as it was.
export function splitRefs(text) {
  const re = new RegExp(REF)
  const parts = []
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const [whole, lead, name, chapter, verse, end] = m
    const nameAt = m.index + whole.indexOf(name, lead ? lead.length : 0)
    // "the book of John 3:16" reads "book of John" as a name: fall back to its last word.
    const word = name.split(/\s+/).pop()
    let found = null
    const full = tryParse(lead, name, chapter, verse, end)
    if (full) found = { from: m.index, ref: full }
    else if (word !== name) {
      const short = tryParse('', word, chapter, verse, end)
      if (short) found = { from: nameAt + name.lastIndexOf(word), ref: short }
    }
    if (!found) {
      // Not a reference. Look again from the next character, since "and 1 Cor 13" starts with a failed "and 1".
      re.lastIndex = m.index + 1
      continue
    }
    if (found.from > last) parts.push({ t: text.slice(last, found.from) })
    parts.push({ t: text.slice(found.from, m.index + whole.length), ref: found.ref })
    last = m.index + whole.length
  }
  if (last < text.length) parts.push({ t: text.slice(last) })
  return parts
}
