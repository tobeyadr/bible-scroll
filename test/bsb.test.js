import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BOOKS } from '../public/books.js'
import { parseChapter } from '../public/parse.js'
import { chapterToText } from '../scripts/build-bsb.mjs'

const book = i => JSON.parse(readFileSync(new URL(`../public/bsb/${i}.json`, import.meta.url)))

test('chapterToText keeps verse numbers, paragraphs and poetry indents', () => {
  const text = chapterToText([
    { type: 'heading', content: ['Ignored heading'] },
    { type: 'line_break', paragraph: 'm' },
    { type: 'verse', number: 1, content: ['First verse.'] },
    { type: 'verse', number: 2, content: ['Second ', { noteId: 1 }, 'verse.'] },
    { type: 'line_break', paragraph: 'm' },
    { type: 'verse', number: 3, content: [{ text: 'A line,', poem: 1 }, { text: 'and its answer.', poem: 2 }, 'Selah'] },
  ])
  assert.equal(text, '[1] First verse. [2] Second verse.\n\n  [3] A line,\n    and its answer.\n    Selah')
})

test('a footnote between two words keeps the space', () => {
  const text = chapterToText([{ type: 'verse', number: 21, content: ['the Lord Jesus', { noteId: 63 }, 'be with all.'] }])
  assert.equal(text, '[21] the Lord Jesus be with all.')
})

test('every bundled chapter exists and parses into cards that cover verses in order', () => {
  let chapters = 0
  BOOKS.forEach((info, i) => {
    const texts = book(i)
    assert.equal(texts.length, info.c, `${info.n} chapter count`)
    texts.forEach((raw, ci) => {
      const label = `${info.n} ${ci + 1}`
      const cards = parseChapter(raw)
      assert.ok(cards.length > 0, `${label} has cards`)
      assert.equal(cards[0].v1, 1, `${label} starts at verse 1`)
      cards.forEach((card, k) => {
        assert.ok(card.v2 >= card.v1, `${label} card ${k} range`)
        // The BSB leaves out a few verses that late manuscripts add (e.g. Matthew 17:21), so allow small gaps.
        if (k) assert.ok(card.v1 >= cards[k - 1].v2 && card.v1 <= cards[k - 1].v2 + 3, `${label} card ${k} follows on`)
      })
      chapters++
    })
  })
  assert.equal(chapters, 1189)
})
