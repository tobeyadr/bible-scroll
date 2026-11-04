import test from 'node:test'
import assert from 'node:assert/strict'
import { wordBounds, toQuery } from '../public/pick.js'

const word = (text, offset) => {
  const b = wordBounds(text, offset)
  return b && text.slice(...b)
}

test('wordBounds finds the word around the tap, wherever in the word it lands', () => {
  const t = 'The Lord is my shepherd; I shall not want.'
  assert.equal(word(t, 5), 'Lord')
  assert.equal(word(t, 4), 'Lord') // start of the word
  assert.equal(word(t, 8), 'Lord') // just after the word
  assert.equal(word(t, 18), 'shepherd')
  assert.equal(word(t, 41), 'want')
})

test('wordBounds drops punctuation, keeps apostrophes inside a word, and ignores gaps', () => {
  assert.equal(word('the Lord’s house', 7), 'Lord’s')
  assert.equal(word('“Come,” he said', 3), 'Come')
  assert.equal(word('said.’ Then', 3), 'said')
  assert.equal(word('God-breathed words', 2), 'God-breathed')
  assert.equal(word('a  b', 2), null)
  assert.equal(word('— —', 1), null)
  assert.equal(word('', 0), null)
})

test('toQuery gives one word as is and several words as a quoted phrase', () => {
  assert.equal(toQuery('shepherd'), 'shepherd')
  assert.equal(toQuery('  shepherd; '), 'shepherd')
  assert.equal(toQuery('born again'), '"born again"')
  assert.equal(toQuery('“For God so loved the world,”'), '"For God so loved the world"')
  assert.equal(toQuery('line one\nline two'), '"line one line two"')
  assert.equal(toQuery('— ,'), '')
  assert.equal(toQuery(''), '')
})

test('toQuery caps a long selection at twelve words', () => {
  const q = toQuery('a b c d e f g h i j k l m n o')
  assert.equal(q, '"a b c d e f g h i j k l"')
})
