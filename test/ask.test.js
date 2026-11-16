import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAsk, sseToText, requestFor, handleAsk, SYSTEM, DEFAULT_MODEL, API_URL } from '../src/ask.js'

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

const delta = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

test('sseToText turns the API events into plain text', async () => {
  const stream = sseToText(sse([delta('Hi '), delta('there'), 'data: {"choices":[{"delta":{"content":null}}]}\n\n', 'data: [DONE]\n\n']))
  assert.equal(await readAll(stream), 'Hi there')
})

test('sseToText copes with events split across chunks, role and usage events, and junk', async () => {
  const stream = sseToText(
    sse([
      'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"choices":[{"delta":{"con',
      'tent":"A"}}]}\n',
      '\ndata: {"usage":{"total_tokens":5},"choices":[]}\n\n: ping\n\ndata: not json\n\n',
      'data: {"choices":[{"delta":{"content":"B"}}]}',
    ]),
  )
  assert.equal(await readAll(stream), 'AB')
})

test('sseToText replaces non-breaking hyphens and spaces', async () => {
  assert.equal(await readAll(sseToText(sse([delta('A night‑time talk, Acts 2:38‑39, then more.')]))), 'A night-time talk, Acts 2:38-39, then more.')
})

test('the request asks for a streamed answer from the chosen model, with a little reasoning', () => {
  const messages = [{ role: 'user', content: 'x' }]
  const body = requestFor({}, messages)
  assert.equal(body.model, DEFAULT_MODEL)
  assert.equal(body.stream, true)
  assert.equal(body.reasoning_effort, 'low') // thinking would eat the answer's token budget
  assert.equal(body.messages, messages)
  assert.ok(body.max_completion_tokens >= 1000)
  assert.ok(!('temperature' in body), 'reasoning models only take the default')

  assert.equal(requestFor({ ASK_MODEL: 'other-model' }, messages).model, 'other-model')
  assert.equal(requestFor({ ASK_REASONING: 'medium' }, messages).reasoning_effort, 'medium')
  assert.ok(!('reasoning_effort' in requestFor({ ASK_REASONING: 'off' }, messages)))
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

// Stands in for the API: records each call and answers with whatever `next` returns.
const fakeApi = () => {
  const api = {
    calls: [],
    next: () => new Response(sse([delta('Answer')]), { headers: { 'Content-Type': 'text/event-stream' } }),
  }
  globalThis.fetch = async (url, init) => {
    api.calls.push({ url, init, body: JSON.parse(init.body) })
    return api.next()
  }
  return api
}

const fakeEnv = (over = {}) => ({ OPENAI_API_KEY: 'sk-test', DB: fakeDb(), ...over })
const post = body =>
  new Request('https://x.test/api/ask', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const quietly = async fn => {
  const quiet = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = quiet
  }
}

test('handleAsk streams the answer from the chat endpoint with the key', async () => {
  const api = fakeApi()
  const res = await handleAsk(post(valid()), fakeEnv())
  assert.equal(res.status, 200)
  assert.match(res.headers.get('Content-Type'), /text\/plain/)
  assert.equal(await res.text(), 'Answer')
  assert.equal(api.calls[0].url, API_URL)
  assert.equal(api.calls[0].init.headers.Authorization, 'Bearer sk-test')
  assert.equal(api.calls[0].body.model, DEFAULT_MODEL)
  assert.equal(api.calls[0].body.messages[0].content, SYSTEM)
  assert.match(api.calls[0].body.messages[1].content, /John 3:16/)
})

test('handleAsk uses the model and address it is configured with', async () => {
  const api = fakeApi()
  await handleAsk(post(valid()), fakeEnv({ ASK_MODEL: 'other-model', ASK_API_URL: 'http://127.0.0.1:9/v1/chat' }))
  assert.equal(api.calls[0].body.model, 'other-model')
  assert.equal(api.calls[0].url, 'http://127.0.0.1:9/v1/chat')
})

test('handleAsk stops at the daily limit, and says how many are left on the way', async () => {
  const api = fakeApi()
  const env = fakeEnv({ ASK_DAILY_LIMIT: '3' })
  const left = []
  for (let i = 0; i < 3; i++) {
    const res = await handleAsk(post(valid()), env)
    assert.equal(res.status, 200)
    left.push(res.headers.get('X-Ask-Left'))
    await res.text()
  }
  assert.deepEqual(left, ['2', '1', '0'])

  const before = api.calls.length
  const over = await handleAsk(post(valid()), env)
  assert.equal(over.status, 429)
  assert.match((await over.json()).error, /all the questions for today \(3\)/)
  assert.equal(api.calls.length, before) // the model is never called past the limit
  assert.equal([...env.DB.days.values()][0], 3) // and the count stays at the limit

  assert.equal((await handleAsk(post(valid()), { ...env, DB: fakeDb(), ASK_DAILY_LIMIT: '0' })).status, 429) // 0 switches it off
})

test('handleAsk does not count bad requests, and gives the question back when the API fails', async () => {
  const api = fakeApi()
  const env = fakeEnv({ ASK_DAILY_LIMIT: '2' })
  await handleAsk(post(valid({ book: 99 })), env)
  assert.equal(env.DB.days.size, 0)

  api.next = () => Response.json({ error: { message: 'model not found' } }, { status: 404 })
  await quietly(async () => {
    for (let i = 0; i < 5; i++) assert.equal((await handleAsk(post(valid()), env)).status, 502)
  })
  assert.equal([...env.DB.days.values()][0], 0) // five failures used none of the two

  api.next = () => Promise.reject(new Error('network'))
  await quietly(async () => assert.equal((await handleAsk(post(valid()), env)).status, 502))
  assert.equal([...env.DB.days.values()][0], 0)
})

test('handleAsk keeps the API error out of the reply but in the log', async () => {
  const api = fakeApi()
  api.next = () => Response.json({ error: { message: 'You exceeded your current quota' } }, { status: 429 })
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args)
  try {
    const res = await handleAsk(post(valid()), fakeEnv())
    assert.equal(res.status, 502)
    assert.ok(!JSON.stringify(await res.json()).includes('quota'))
  } finally {
    console.error = original
  }
  assert.match(String(logged[0][1]), /OpenAI 429: You exceeded your current quota/)
})

test('handleAsk refuses rather than answer uncounted when there is no database', async () => {
  fakeApi()
  assert.equal((await handleAsk(post(valid()), fakeEnv({ DB: undefined }))).status, 500)
})

test('handleAsk refuses bad input, a missing key and a busy address', async () => {
  const api = fakeApi()
  assert.equal((await handleAsk(post('{nope'), fakeEnv())).status, 400)
  assert.equal((await handleAsk(post(valid({ book: 99 })), fakeEnv())).status, 400)
  assert.equal((await handleAsk(post('x'.repeat(30000)), fakeEnv())).status, 413)
  assert.equal((await handleAsk(post(valid()), fakeEnv({ OPENAI_API_KEY: undefined }))).status, 500)

  const limited = fakeEnv({ ASK_LIMITER: { limit: async () => ({ success: false }) } })
  const res = await handleAsk(post(valid()), limited)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('Retry-After'), '60')
  assert.equal(api.calls.length, 0)
})
