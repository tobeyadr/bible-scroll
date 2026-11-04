import test from 'node:test'
import assert from 'node:assert/strict'
import { remember, forget, readList, MAX_SEARCHES } from '../public/searchhistory.js'

test('remember puts the newest search first and drops repeats however they are typed', () => {
  let list = []
  list = remember(list, 'shepherd')
  list = remember(list, 'john 3:16')
  list = remember(list, '  Shepherd ')
  assert.deepEqual(list, ['Shepherd', 'john 3:16'])
})

test('remember ignores searches too short to mean anything', () => {
  assert.deepEqual(remember([], ''), [])
  assert.deepEqual(remember([], ' a '), [])
  assert.deepEqual(remember([], '"" ,'), [])
  assert.deepEqual(remember([], 'ps'), ['ps'])
})

test('remember keeps only the most recent searches', () => {
  let list = []
  for (let i = 0; i < MAX_SEARCHES + 5; i++) list = remember(list, `word${i}`)
  assert.equal(list.length, MAX_SEARCHES)
  assert.equal(list[0], `word${MAX_SEARCHES + 4}`)
})

test('forget removes one search', () => {
  assert.deepEqual(forget(['a1', 'b2', 'c3'], ' B2 '), ['a1', 'c3'])
})

test('readList copes with whatever is in storage', () => {
  assert.deepEqual(readList(null), [])
  assert.deepEqual(readList('oops'), [])
  assert.deepEqual(readList(['shepherd', 7, '', 'x', 'grace']), ['shepherd', 'grace'])
})
