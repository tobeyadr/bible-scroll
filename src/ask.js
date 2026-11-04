import { BOOKS, refLabel } from '../public/books.js'

// "Ask about this passage": a study companion on Cloudflare Workers AI. There is no API key; the AI binding
// in wrangler.jsonc is the credential. The model is a setting (ASK_MODEL) so it can change without a code edit.
export const DEFAULT_MODEL = '@cf/openai/gpt-oss-120b'

// Reasoning models think before they answer, and that thinking counts against max_tokens, so questions about a
// verse (which need recall more than deliberation) ask for as little of it as the model allows.
const MODEL_PARAMS = {
  '@cf/openai/gpt-oss-120b': { reasoning: { effort: 'low' } },
  '@cf/moonshotai/kimi-k2.6': { reasoning_effort: 'none' },
  '@cf/deepseek-ai/deepseek-v4-pro-0813': { reasoning_effort: 'none' },
}

// Questions a day, all devices together (ASK_DAILY_LIMIT overrides it). At roughly a fifth of a cent each, 40 is
// about 8 cents a day at most.
export const DAILY_LIMIT = 40

const LIMIT = { body: 24000, passage: 2000, question: 600, answer: 6000, turns: 12, label: 24 }

// After editing this, ask a real question (see README). With some wordings, gpt-oss-120b answers with nothing but
// "!!!!!" until max_tokens runs out; it did when a sentence quoted example replies with apostrophes.
export const SYSTEM = `You are sAInt, a study companion inside a Bible reading app, helping one reader understand the passage they are looking at. The passage is quoted in their first message.

How to answer:
- Answer the question that was asked, about that passage. If a question has nothing to do with the Bible, faith or the history behind them, say briefly that you are here for the passage.
- Write in short paragraphs of plain prose. No headings. Use a hyphen list only to set out parallel views or items, starting each item with its name in **bold**. You may use *italics* for transliterated words, titles and light emphasis. Use no other markdown.
- Keep answers under 200 words unless the reader asks for more. Choose the points that matter most rather than covering everything; the reader can ask a follow-up.
- Where traditions read a passage differently, describe the main positions fairly and say who holds them (for example Catholic, Eastern Orthodox, Lutheran, Reformed, Anglican, Baptist, Pentecostal, or Jewish readers of the Old Testament) without ranking them. Say where there is wide agreement.
- Stay with readings that the historic traditions or mainstream scholarship hold. If the reader asks for a fringe or speculative theory, say briefly that you keep to well-supported readings, then give the mainstream view of the passage instead.
- Keep what is well attested apart from what is debated or speculative. Never invent quotations, scholars, inscriptions, excavations, dates or citations. If you are not sure of a fact, say so. Admitting uncertainty is always acceptable, and better than a confident guess. Whenever your confidence is low, say plainly that you are not sure, or that you do not know of anything on the point. This matters most for obscure names, movements, Hebrew or Greek words, dates, archaeological finds and what a particular group believes. A short honest answer is fine. Name a manuscript, inscription or site only when you are confident it exists and bears on the passage.
- Give only the answer itself: no preamble about what the reader asked, and none of your own planning or notes.
- Mention the Hebrew, Aramaic or Greek behind a word only where it changes the sense, with a simple transliteration.
- Refer to other passages as "John 3:16" or "1 Cor 13:4-7" so the app can link them.
- You are a study aid, not a pastor or a final authority. Encourage the reader to weigh what you say against the text itself.`

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const isCount = n => Number.isInteger(n) && n >= 1

// Checks what the app sent and builds the chat for the model. The passage text comes from the app (so it is the
// translation the reader sees), and goes into the first user message; only the reader's own chat is affected by it.
export function parseAsk(body) {
  if (!body || typeof body !== 'object') return { error: 'Bad request' }
  const { book, chapter, v1, v2, passage, translation, turns } = body
  const info = BOOKS[book]
  if (!Number.isInteger(book) || !info || !isCount(chapter) || chapter > info.c) return { error: 'Unknown book or chapter' }
  if (!isCount(v1) || !isCount(v2) || v2 < v1 || v2 > 200) return { error: 'Unknown verses' }
  if (typeof passage !== 'string' || !passage.trim()) return { error: 'Missing passage' }
  if (!Array.isArray(turns) || !turns.length || turns.length > LIMIT.turns) return { error: 'Bad conversation' }

  for (const [i, turn] of turns.entries()) {
    const role = i % 2 ? 'assistant' : 'user'
    const max = role === 'user' ? LIMIT.question : LIMIT.answer
    if (turn?.role !== role || typeof turn.content !== 'string' || !turn.content.trim() || turn.content.length > max) {
      return { error: 'Bad conversation' }
    }
  }
  if (turns.at(-1).role !== 'user') return { error: 'Bad conversation' }

  const label = typeof translation === 'string' ? translation.replace(/[^\w() -]/g, '').slice(0, LIMIT.label) : ''
  const quoted = `The reader is looking at ${refLabel(book, chapter, v1, v2)}${label ? ` (${label})` : ''}:\n"${passage.trim().slice(0, LIMIT.passage)}"\n\nTheir question: `
  const messages = turns.map((t, i) => ({ role: t.role, content: i ? t.content : quoted + t.content }))
  return { messages: [{ role: 'system', content: SYSTEM }, ...messages] }
}

// Workers AI streams server-sent events. Depending on the model each event carries the next piece of text as
// `response` or as an OpenAI-style `choices[0].delta.content`; the app gets plain text either way.
export function sseToText(stream) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  const answer = answerFilter()

  const emit = (line, controller) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let chunk
    try {
      chunk = JSON.parse(data)
    } catch {
      return
    }
    const text = chunk.response ?? chunk.choices?.[0]?.delta?.content
    if (typeof text === 'string' && text) send(answer.push(text), controller)
  }
  const send = (text, controller) => text && controller.enqueue(encoder.encode(text))

  return stream.pipeThrough(
    new TransformStream({
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) emit(line.trim(), controller)
      },
      flush(controller) {
        emit(buffer.trim(), controller)
        send(answer.end(), controller)
      },
    }),
  )
}

// gpt-oss writes its reasoning to a separate field, which is dropped above. Now and then the markers between its
// reasoning and its answer are lost and the reasoning arrives as part of the answer, as "analysis" then the
// thinking, then "assistantfinal" and the real answer. An answer never starts with a lowercase "analysis", so
// that is the sign: hold the text back until the marker shows up, drop what came before it, and carry on. If the
// marker never comes the held text is shown rather than nothing. Typographic clean-up happens here too: the model
// likes non-breaking hyphens and spaces, which only make odd line breaks and missing glyphs.
const LEAK_START = /^(analysis|commentary)/
const FINAL_MARKER = /assistant\s*final|<\|channel\|>\s*final\s*<\|message\|>/i
const tidyText = text => text.replace(/[‐‑]/g, '-').replace(/[  ]/g, ' ')

export function answerFilter() {
  let mode = 'detect' // detect -> pass, or detect -> leak -> pass
  let held = ''

  return {
    push(text) {
      if (mode === 'pass') return tidyText(text)
      held += text
      if (mode === 'detect') {
        const head = held.trimStart()
        if (head.length < 10) return '' // too early to tell
        if (!LEAK_START.test(head)) {
          mode = 'pass'
          const text = held
          held = ''
          return tidyText(text)
        }
        mode = 'leak'
      }
      const marker = FINAL_MARKER.exec(held)
      if (!marker) return ''
      mode = 'pass'
      const rest = held.slice(marker.index + marker[0].length).trimStart()
      held = ''
      return tidyText(rest)
    },
    // What is still held when the stream ends.
    end() {
      const rest = mode === 'leak' ? held.trimStart().replace(LEAK_START, '').trimStart() : held
      held = ''
      mode = 'pass'
      return tidyText(rest)
    },
  }
}

const TRIES = 3
// A normal answer starts within 5 to 12 seconds. A stuck one can sit silent for a minute before it shows.
const FIRST_WORDS_MS = 30000

// One character repeated over and over at the start is the model stuck, never a real answer.
export const isStuck = text => /^(\S)\1{7,}/.test(text.trimStart())

// Reads the first words of an answer. If they are fine, returns the whole answer as a stream (those words first,
// then the rest as it arrives); if the model is stuck or too slow to start, cancels it and returns null.
export async function startAnswer(text, waitMs = FIRST_WORDS_MS) {
  const reader = text.getReader()
  const decoder = new TextDecoder()
  const first = []
  const deadline = Date.now() + waitMs
  let seen = ''
  let ended = false
  let late = false
  while (seen.trim().length < 12 && !ended && !late) {
    let timer
    const next = await Promise.race([
      reader.read(),
      new Promise(resolve => (timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())))),
    ])
    clearTimeout(timer)
    if (!next) late = true
    else if (next.done) ended = true
    else {
      first.push(next.value)
      seen += decoder.decode(next.value, { stream: true })
    }
  }
  if (late || isStuck(seen)) {
    await reader.cancel().catch(() => {})
    return null
  }
  return new ReadableStream({
    start(controller) {
      for (const chunk of first) controller.enqueue(chunk)
      if (ended) controller.close()
    },
    async pull(controller) {
      if (ended) return
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel: reason => reader.cancel(reason),
  })
}

export async function handleAsk(request, env) {
  if (!env.AI) return json({ error: 'AI is not configured' }, 500)

  // Every question costs money, so one address only gets a few a minute.
  const ip = request.headers.get('CF-Connecting-IP') || 'local'
  if (env.ASK_LIMITER && !(await env.ASK_LIMITER.limit({ key: `ask:${ip}` })).success) {
    return json({ error: 'Too many questions. Wait a minute and try again.' }, 429, { 'Retry-After': '60' })
  }

  const raw = await request.text()
  if (raw.length > LIMIT.body) return json({ error: 'Request too large' }, 413)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Bad request' }, 400)
  }
  const { messages, error } = parseAsk(body)
  if (error) return json({ error }, 400)

  // The bill's ceiling: a fixed number of questions a day across every device. Counting happens before the
  // model is called, so a burst of requests cannot get past it.
  const quota = await takeQuestion(env)
  if (quota.error) return json({ error: quota.error }, quota.status)

  let stream = null
  try {
    const model = env.ASK_MODEL || DEFAULT_MODEL
    const params = { messages, stream: true, max_tokens: 1200, temperature: 0.4, ...MODEL_PARAMS[model] }
    // The model sometimes gets stuck repeating one character. That shows in the first words, so look at them and
    // try again (quietly, and without using another of the day's questions) rather than hand over junk.
    for (let attempt = 1; attempt <= TRIES && !stream; attempt++) {
      stream = await startAnswer(sseToText(await env.AI.run(model, params)))
      if (!stream) console.warn(`ask: stuck answer, attempt ${attempt} of ${TRIES}`)
    }
  } catch (err) {
    console.error('ask failed', err)
    await giveBackQuestion(env, quota.day)
    return json({ error: 'sAInt is not available right now. Try again later.' }, 502)
  }
  if (!stream) {
    await giveBackQuestion(env, quota.day)
    return json({ error: 'sAInt got stuck on that one. Try asking again.' }, 502)
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Ask-Left': String(quota.left),
    },
  })
}

// ---------- daily limit ----------

let schema = null
function ensureSchema(db) {
  schema ??= db.exec('CREATE TABLE IF NOT EXISTS ask_usage (day TEXT PRIMARY KEY, n INTEGER NOT NULL)').catch(err => {
    schema = null
    throw err
  })
  return schema
}

export const dailyLimit = env => Math.max(0, Math.floor(Number(env.ASK_DAILY_LIMIT ?? DAILY_LIMIT)) || 0)

// Uses one of today's questions (the day is UTC), or says why not. Without the database there is no way to count,
// so it refuses rather than letting questions through uncounted.
export async function takeQuestion(env) {
  if (!env.DB) return { error: 'The question limit is not set up on this server.', status: 500 }
  const limit = dailyLimit(env)
  const day = new Date().toISOString().slice(0, 10)
  await ensureSchema(env.DB)
  const row = await env.DB.prepare('INSERT INTO ask_usage (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(day)
    .first()
  if (row.n > limit) {
    await giveBackQuestion(env, day) // so the count stays at the limit
    return { error: `That is all the questions for today (${limit}). It starts again at midnight UTC.`, status: 429 }
  }
  return { day, left: limit - row.n }
}

async function giveBackQuestion(env, day) {
  await env.DB.prepare('UPDATE ask_usage SET n = MAX(n - 1, 0) WHERE day = ?').bind(day).run().catch(() => {})
}
