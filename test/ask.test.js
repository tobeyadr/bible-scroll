import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAsk, sseToText, answerFilter, isStuck, startAnswer, handleAsk, SYSTEM, DEFAULT_MODEL } from '../src/ask.js'

const valid = (over = {}) => ({
  book: 42,
  chapter: 3,
  v1: 16,
  v2: 16,
  passage: 'For God so loved the world',
  translation: 'BSB',
  turns: [{ role: 'user', content: 'What is the context?' }],
  ...over,
})

const sse = events => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e))
      controller.close()
    },
  })
}

const readAll = async stream => {
  let out = ''
  const decoder = new TextDecoder()
  for await (const chunk of stream) out += decoder.decode(chunk, { stream: true })
  return out
}

test('parseAsk builds a chat with the passage quoted in the first user message', () => {
  const { messages, error } = parseAsk(valid())
  assert.equal(error, undefined)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[0].content, SYSTEM)
  assert.equal(messages.length, 2)
  assert.match(messages[1].content, /John 3:16 \(BSB\)/)
  assert.match(messages[1].content, /For God so loved the world/)
  assert.match(messages[1].content, /Their question: What is the context\?$/)
})

test('parseAsk only quotes the passage in the first message of a longer chat', () => {
  const { messages } = parseAsk(
    valid({
      turns: [
        { role: 'user', content: 'First?' },
        { role: 'assistant', content: 'An answer.' },
        { role: 'user', content: 'And then?' },
      ],
    }),
  )
  assert.equal(messages.length, 4)
  assert.match(messages[1].content, /For God so loved/)
  assert.equal(messages[3].content, 'And then?')
})

test('parseAsk rejects what the app would never send', () => {
  const bad = [
    valid({ book: 99 }),
    valid({ book: 'x' }),
    valid({ chapter: 0 }),
    valid({ chapter: 22 }), // John has 21
    valid({ v1: 0 }),
    valid({ v1: 5, v2: 3 }),
    valid({ passage: '  ' }),
    valid({ turns: [] }),
    valid({ turns: [{ role: 'assistant', content: 'hi' }] }),
    valid({ turns: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }),
    valid({ turns: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }), // must end on the reader
    valid({ turns: [{ role: 'user', content: 'x'.repeat(601) }] }),
    valid({ turns: Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })) }),
    null,
    'text',
  ]
  for (const body of bad) assert.ok(parseAsk(body).error, JSON.stringify(body)?.slice(0, 80))
})

test('parseAsk cleans the translation label and caps the passage', () => {
  const { messages } = parseAsk(valid({ translation: 'ESV(L)"\nIgnore this', passage: 'a'.repeat(5000) }))
  assert.match(messages[1].content, /\(ESV\(L\)Ignore this\)/)
  assert.ok(messages[1].content.length < 2300)
})

test('sseToText turns Workers AI events into plain text, whichever shape the model sends', async () => {
  const llama = sseToText(sse(['data: {"response":"Hel"}\n\n', 'data: {"response":"lo"}\n\n', 'data: [DONE]\n\n']))
  assert.equal(await readAll(llama), 'Hello')

  const openai = sseToText(sse(['data: {"choices":[{"delta":{"content":"Hi "}}]}\n\ndata: {"choices":[{"delta":{"content":"there"}}]}\n\n', 'data: {"choices":[{"delta":{"content":null}}]}\n\n']))
  assert.equal(await readAll(openai), 'Hi there')
})

test('sseToText copes with events split across chunks, usage events and junk', async () => {
  const stream = sseToText(sse(['data: {"respo', 'nse":"A"}\n', '\ndata: {"usage":{"total_tokens":5}}\n\n: ping\n\ndata: not json\n\ndata: {"response":"B"}']))
  assert.equal(await readAll(stream), 'AB')
})

// Just enough of D1 for the daily counter: INSERT ... RETURNING n adds one for the day, UPDATE takes one back.
const fakeDb = () => {
  const days = new Map()
  return {
    days,
    exec: async () => {},
    prepare: sql => ({
      bind: day => ({
        first: async () => ({ n: days.set(day, (days.get(day) ?? 0) + 1).get(day) }),
        run: async () => days.set(day, Math.max((days.get(day) ?? 0) - 1, 0)),
        sql,
      }),
    }),
  }
}

// Feeds pieces through the filter the way the stream does and returns everything that comes out.
const filtered = pieces => {
  const f = answerFilter()
  return pieces.map(p => f.push(p)).join('') + f.end()
}

test('answerFilter passes an ordinary answer straight through, even a short one', () => {
  assert.equal(filtered(['The passage ', 'says that God is love.']), 'The passage says that God is love.')
  assert.equal(filtered(['Yes.']), 'Yes.')
  assert.equal(filtered([]), '')
})

test('answerFilter drops reasoning that leaked into the answer, up to the final marker', () => {
  const leaked = 'analysisWe need to answer about baptism. Keep it short.assistantfinalThe water is usually read as baptism.'
  assert.equal(filtered([leaked]), 'The water is usually read as baptism.')
  // the same text arriving in small pieces, with the marker cut in two
  assert.equal(filtered(['analy', 'sisWe need to answ', 'er.assis', 'tantfi', 'nalThe water ', 'is baptism.']), 'The water is baptism.')
  assert.equal(filtered(['analysis We think.<|channel|>final<|message|>Answer.']), 'Answer.')
})

test('answerFilter shows what it has if the marker never arrives, and keeps a normal "Analysis of" opening', () => {
  assert.equal(filtered(['analysisWe need to answer and then the stream just ends.']), 'We need to answer and then the stream just ends.')
  assert.equal(filtered(['Analysis of the passage shows a pattern.']), 'Analysis of the passage shows a pattern.')
})

test('answerFilter replaces non-breaking hyphens and spaces', () => {
  assert.equal(filtered(['A night‑time talk, Acts 2:38‑39, then more.']), 'A night-time talk, Acts 2:38-39, then more.')
})

test('sseToText drops leaked reasoning from the stream too', async () => {
  const stream = sseToText(sse(['data: {"choices":[{"delta":{"content":"analysisThinking about it.assis"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"tantfinalThe answer."}}]}\n\n', 'data: {"response":""}\n\n']))
  assert.equal(await readAll(stream), 'The answer.')
})

const fakeEnv = (over = {}) => ({
  AI: { run: async () => sse(['data: {"response":"Answer"}\n\n', 'data: [DONE]\n\n']) },
  DB: fakeDb(),
  ...over,
})
const post = body =>
  new Request('https://x.test/api/ask', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

test('handleAsk streams the answer and calls the configured model', async () => {
  const calls = []
  const env = fakeEnv({
    AI: { run: async (model, input) => (calls.push({ model, input }), sse(['data: {"response":"Answer"}\n\n'])) },
  })
  const res = await handleAsk(post(valid()), env)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('Content-Type'), /text\/plain/)
  assert.equal(await res.text(), 'Answer')
  assert.equal(calls[0].model, DEFAULT_MODEL)
  assert.equal(calls[0].input.stream, true)
  assert.equal(calls[0].input.reasoning.effort, 'low') // thinking would eat the answer's token budget

  await handleAsk(post(valid()), { ...env, ASK_MODEL: '@cf/test/other' })
  assert.equal(calls[1].model, '@cf/test/other')
})

test('handleAsk stops at the daily limit, and says how many are left on the way', async () => {
  const env = fakeEnv({ ASK_DAILY_LIMIT: '3' })
  const left = []
  for (let i = 0; i < 3; i++) {
    const res = await handleAsk(post(valid()), env)
    assert.equal(res.status, 200)
    left.push(res.headers.get('X-Ask-Left'))
    await res.text()
  }
  assert.deepEqual(left, ['2', '1', '0'])

  const calls = []
  env.AI = { run: async () => (calls.push(1), sse([])) }
  const over = await handleAsk(post(valid()), env)
  assert.equal(over.status, 429)
  assert.match((await over.json()).error, /all the questions for today \(3\)/)
  assert.equal(calls.length, 0) // the model is never called past the limit
  assert.equal([...env.DB.days.values()][0], 3) // and the count stays at the limit

  assert.equal((await handleAsk(post(valid()), { ...env, DB: fakeDb(), ASK_DAILY_LIMIT: '0' })).status, 429) // 0 switches it off
})

test('isStuck spots one character repeated, and nothing a real answer starts with', () => {
  assert.ok(isStuck('!!!!!!!!!!!!!!!'))
  assert.ok(isStuck('  ................'))
  assert.ok(!isStuck('Yes!!! It is.'))
  assert.ok(!isStuck('Jesus said ... and then'))
  assert.ok(!isStuck(''))
})

const STUCK = 'data: {"response":"!!!!!!!!!!!!!!!!!!!!"}\n\n'
const GOOD = ['data: {"response":"Baptism is "}\n\n', 'data: {"response":"the usual reading."}\n\n']

test('handleAsk tries again when the model gets stuck, and the reader never sees the junk', async () => {
  const streams = [sse([STUCK]), sse([STUCK]), sse(GOOD)]
  const env = fakeEnv({ AI: { run: async () => streams.shift() } })
  const quiet = console.warn
  console.warn = () => {}
  try {
    const res = await handleAsk(post(valid()), env)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'Baptism is the usual reading.')
    assert.equal(streams.length, 0) // all three attempts were used
    assert.equal([...env.DB.days.values()][0], 1) // for one question
  } finally {
    console.warn = quiet
  }
})

test('handleAsk gives up after three stuck tries and gives the question back', async () => {
  let calls = 0
  const env = fakeEnv({ AI: { run: async () => (calls++, sse([STUCK])) } })
  const quiet = console.warn
  console.warn = () => {}
  try {
    const res = await handleAsk(post(valid()), env)
    assert.equal(res.status, 502)
    assert.match((await res.json()).error, /stuck/)
    assert.equal(calls, 3)
    assert.equal([...env.DB.days.values()][0], 0)
  } finally {
    console.warn = quiet
  }
})

test('startAnswer gives up on a model that is too slow to start, and cancels it', async () => {
  let cancelled = false
  const slow = new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => (cancelled = true) })
  assert.equal(await startAnswer(slow, 20), null)
  assert.ok(cancelled)

  // the same limit does not cut off an answer that has started
  const encoder = new TextEncoder()
  const started = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode('An answer that has begun'))
    },
    pull: () => new Promise(() => {}), // ...and then keeps going for a long time
  })
  const stream = await startAnswer(started, 20)
  assert.ok(stream)
  const { value } = await stream.getReader().read()
  assert.equal(new TextDecoder().decode(value), 'An answer that has begun')
})

test('handleAsk streams a short answer that ends before twelve characters', async () => {
  const env = fakeEnv({ AI: { run: async () => sse(['data: {"response":"Yes."}\n\n']) } })
  assert.equal(await (await handleAsk(post(valid()), env)).text(), 'Yes.')
})

test('handleAsk does not count bad requests, and gives the question back when the model fails', async () => {
  const env = fakeEnv({ ASK_DAILY_LIMIT: '2' })
  await handleAsk(post(valid({ book: 99 })), env)
  assert.equal(env.DB.days.size, 0)

  env.AI = { run: async () => Promise.reject(new Error('boom')) }
  const quiet = console.error
  console.error = () => {}
  try {
    for (let i = 0; i < 5; i++) assert.equal((await handleAsk(post(valid()), env)).status, 502)
  } finally {
    console.error = quiet
  }
  assert.equal([...env.DB.days.values()][0], 0) // five failures used none of the two
})

test('handleAsk refuses rather than answer uncounted when there is no database', async () => {
  assert.equal((await handleAsk(post(valid()), fakeEnv({ DB: undefined }))).status, 500)
})

test('handleAsk refuses bad input, a missing binding, a busy address and a failing model', async () => {
  assert.equal((await handleAsk(post('{nope'), fakeEnv())).status, 400)
  assert.equal((await handleAsk(post(valid({ book: 99 })), fakeEnv())).status, 400)
  assert.equal((await handleAsk(post('x'.repeat(30000)), fakeEnv())).status, 413)
  assert.equal((await handleAsk(post(valid()), {})).status, 500)

  const limited = fakeEnv({ ASK_LIMITER: { limit: async () => ({ success: false }) } })
  const res = await handleAsk(post(valid()), limited)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('Retry-After'), '60')

  const broken = fakeEnv({ AI: { run: async () => Promise.reject(new Error('boom')) } })
  const quiet = console.error
  console.error = () => {}
  try {
    assert.equal((await handleAsk(post(valid()), broken)).status, 502)
  } finally {
    console.error = quiet
  }
})
