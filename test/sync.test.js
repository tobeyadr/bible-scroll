import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeDocs, emptyDoc, sameDoc, TOMBSTONE_TTL } from '../public/merge.js'
import { createState } from '../public/state.js'
import { generateSecret, phraseFromSecret, secretFromPhrase, deriveKeys, encryptDoc, decryptDoc } from '../public/keys.js'

const memory = (initial = {}) => {
  const data = new Map(Object.entries(initial))
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }
}

const doc = (parts = {}) => ({ ...emptyDoc(), ...parts })
const note = (text, u, extra = {}) => ({ b: 42, c: 3, v1: 16, v2: 16, text, at: u, u, ...extra })

test('merge keeps the newest edit of each item', () => {
  const a = doc({ notes: { n1: note('old', 100) } })
  const b = doc({ notes: { n1: note('new', 200) } })
  assert.equal(mergeDocs(a, b, 1000).notes.n1.text, 'new')
  assert.equal(mergeDocs(b, a, 1000).notes.n1.text, 'new')
})

test('merge takes the union of items from both devices', () => {
  const a = doc({ notes: { n1: note('one', 100) }, saved: { s1: { b: 0, c: 1, v1: 1, v2: 2, u: 100 } } })
  const b = doc({ notes: { n2: note('two', 150) } })
  const m = mergeDocs(a, b, 1000)
  assert.deepEqual(Object.keys(m.notes).sort(), ['n1', 'n2'])
  assert.deepEqual(Object.keys(m.saved), ['s1'])
})

test('a deletion beats an older edit and spreads to the other device', () => {
  const a = doc({ notes: { n1: note('keep me?', 100) } })
  const b = doc({ notes: { n1: { u: 200, d: 1 } } })
  assert.equal(mergeDocs(a, b, 1000).notes.n1.d, 1)
  // ...but a later edit on the other device wins over the delete
  const c = doc({ notes: { n1: note('rewritten', 300) } })
  assert.equal(mergeDocs(b, c, 1000).notes.n1.text, 'rewritten')
})

test('old deletion markers are dropped', () => {
  const a = doc({ notes: { n1: { u: 100, d: 1 } } })
  assert.deepEqual(mergeDocs(a, emptyDoc(), 100 + TOMBSTONE_TTL + 1).notes, {})
  assert.ok(mergeDocs(a, emptyDoc(), 100 + TOMBSTONE_TTL - 1).notes.n1)
})

test('merge is commutative and idempotent, including exact ties', () => {
  const a = doc({ notes: { n1: note('from a', 100) }, pos: { b: 1, c: 1, v: 1, u: 50 } })
  const b = doc({ notes: { n1: note('from b', 100) }, pos: { b: 2, c: 2, v: 2, u: 60 } })
  const ab = mergeDocs(a, b, 1000)
  assert.ok(sameDoc(ab, mergeDocs(b, a, 1000)))
  assert.ok(sameDoc(ab, mergeDocs(ab, a, 1000)))
  assert.ok(sameDoc(ab, mergeDocs(ab, ab, 1000)))
  assert.deepEqual(ab.pos, b.pos)
})

test('merge tolerates missing or malformed input', () => {
  assert.deepEqual(mergeDocs(null, undefined), emptyDoc())
  assert.deepEqual(mergeDocs({ notes: 'nope', saved: [] }, emptyDoc()), emptyDoc())
})

test('state: notes overlap by verse range, edits keep their creation time, deletes are hidden', () => {
  const state = createState(memory())
  const id = state.saveNote({ b: 42, c: 3, v1: 16, v2: 18, text: 'first' })
  state.saveNote({ b: 42, c: 3, v1: 30, v2: 30, text: 'elsewhere' })
  assert.equal(state.notesFor(42, 3, 14, 16).length, 1)
  assert.equal(state.notesFor(42, 3, 19, 25).length, 0)
  assert.equal(state.notesFor(42, 4, 16, 18).length, 0)

  const at = state.snapshot().notes[id].at
  state.saveNote({ id, b: 42, c: 3, v1: 16, v2: 18, text: 'edited' })
  assert.equal(state.snapshot().notes[id].at, at)
  assert.equal(state.notesFor(42, 3, 16, 16)[0].text, 'edited')

  state.deleteNote(id)
  assert.equal(state.notesFor(42, 3, 16, 16).length, 0)
  assert.equal(state.snapshot().notes[id].d, 1)
})

test('state: saved passages toggle and notify listeners', () => {
  const state = createState(memory())
  const seen = []
  state.onChange(source => seen.push(source))
  const item = { k: '42.3.16-18', b: 42, c: 3, v1: 16, v2: 18 }
  state.setSaved(item, true)
  assert.ok(state.isSaved(item.k))
  assert.equal(state.savedList().length, 1)
  state.setSaved(item, false)
  assert.ok(!state.isSaved(item.k))
  assert.deepEqual(seen, ['local', 'local'])
})

test('state: the position only changes when it moves', () => {
  const state = createState(memory())
  state.setPos({ b: 1, c: 2, v: 3 })
  const u = state.getPos().u
  state.setPos({ b: 1, c: 2, v: 3 })
  assert.equal(state.getPos().u, u)
})

test('state: data from the first version of the app is migrated', () => {
  const state = createState(
    memory({
      'bs:saved': JSON.stringify([{ k: '0.1.1-2', b: 0, c: 1, v1: 1, v2: 2, at: 123 }]),
      'bs:pos': JSON.stringify({ b: 18, c: 23, v: 1 }),
    }),
  )
  assert.equal(state.savedList()[0].k, '0.1.1-2')
  assert.equal(state.getPos().c, 23)
})

test('sync phrase round-trips and is 12 words', async () => {
  const secret = generateSecret()
  const phrase = await phraseFromSecret(secret)
  assert.equal(phrase.split(' ').length, 12)
  assert.deepEqual(await secretFromPhrase(phrase), secret)
  assert.deepEqual(await secretFromPhrase(`  ${phrase.toUpperCase().replace(/ /g, ',  ')} `), secret)
})

test('a mistyped sync phrase is rejected', async () => {
  const phrase = await phraseFromSecret(generateSecret())
  const words = phrase.split(' ')
  await assert.rejects(() => secretFromPhrase(words.slice(0, 11).join(' ')), /12 words/)
  await assert.rejects(() => secretFromPhrase([...words.slice(0, 11), 'notaword'].join(' ')), /word list/)
  // The 4-bit checksum catches 15 in 16 wrong words, so among 16 swaps most must be rejected.
  const { WORDS } = await import('../public/wordlist.js')
  let rejected = 0
  for (let i = 0; i < 16; i++) {
    const wrong = [...words.slice(0, 11), WORDS[i * 100]]
    if (wrong.join(' ') === phrase) continue
    await secretFromPhrase(wrong.join(' ')).catch(err => {
      assert.match(err.message, /do not match/)
      rejected++
    })
  }
  assert.ok(rejected >= 12, `only ${rejected} of 16 wrong phrases were rejected`)
})

test('derived keys are stable, distinct, and encrypt round-trips', async () => {
  const secret = generateSecret()
  const a = await deriveKeys(secret)
  const b = await deriveKeys(secret)
  assert.equal(a.id, b.id)
  assert.equal(a.token, b.token)
  assert.match(a.id, /^[0-9a-f]{64}$/)
  assert.notEqual(a.id, a.token)

  const data = doc({ notes: { n1: note('private thought', 1) } })
  const blob = await encryptDoc(a.key, data)
  assert.ok(!Buffer.from(blob, 'base64').toString('latin1').includes('private thought'))
  assert.deepEqual(await decryptDoc(b.key, blob), data)

  const other = await deriveKeys(generateSecret())
  await assert.rejects(() => decryptDoc(other.key, blob))
})
