import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAnswer } from '../public/ask.js'

test('paragraphs, and a paragraph the model wrapped by hand', () => {
  assert.deepEqual(parseAnswer('First paragraph.\n\nSecond one,\nwrapped onto a line.'), [
    { t: 'p', s: 'First paragraph.' },
    { t: 'p', s: 'Second one, wrapped onto a line.' },
  ])
})

test('bullet lists, with or without blank lines between the items, and with the other bullet marks', () => {
  const want = [{ t: 'ul', items: ['**Catholic** – baptism.', '**Baptist** – testimony.'] }]
  assert.deepEqual(parseAnswer('- **Catholic** – baptism.\n- **Baptist** – testimony.'), want)
  assert.deepEqual(parseAnswer('- **Catholic** – baptism.\n\n- **Baptist** – testimony.'), want)
  assert.deepEqual(parseAnswer('* **Catholic** – baptism.\n• **Baptist** – testimony.'), want)
})

test('a list item carried onto an indented line stays one item', () => {
  assert.deepEqual(parseAnswer('- **“The Lord is my shepherd.”**  \n  A shepherd provides.\n- Next item.'), [
    { t: 'ul', items: ['**“The Lord is my shepherd.”** A shepherd provides.', 'Next item.'] },
  ])
})

test('numbered lists, and lists that end when text follows', () => {
  assert.deepEqual(parseAnswer('Three things:\n\n1. Repent.\n2) Be baptized.\n3. Receive the Spirit.\n\nThat is the pattern.'), [
    { t: 'p', s: 'Three things:' },
    { t: 'ol', items: ['Repent.', 'Be baptized.', 'Receive the Spirit.'] },
    { t: 'p', s: 'That is the pattern.' },
  ])
})

test('headings become a bold line and do not swallow the text after them', () => {
  assert.deepEqual(parseAnswer('## Context\nIt was night.\n\n### Meaning ###\nIt is about birth.'), [
    { t: 'p', s: '**Context**' },
    { t: 'p', s: 'It was night.' },
    { t: 'p', s: '**Meaning**' },
    { t: 'p', s: 'It is about birth.' },
  ])
})

test('rules and table dividers are dropped, and table rows become one line', () => {
  assert.deepEqual(parseAnswer('Views:\n\n---\n| Church | View |\n|---|---|\n| Lutheran | Baptism |\n\nDone.'), [
    { t: 'p', s: 'Views:' },
    { t: 'p', s: 'Church · View' },
    { t: 'p', s: 'Lutheran · Baptism' },
    { t: 'p', s: 'Done.' },
  ])
})

test('an empty answer, Windows line ends and stray spaces are fine', () => {
  assert.deepEqual(parseAnswer(''), [])
  assert.deepEqual(parseAnswer('  \n\n '), [])
  assert.deepEqual(parseAnswer('One.  \r\n\r\nTwo.'), [{ t: 'p', s: 'One.' }, { t: 'p', s: 'Two.' }])
})
