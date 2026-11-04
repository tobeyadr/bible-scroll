import { refLabel } from './books.js'
import { $, make } from './dom.js'
import { splitRefs } from './refs.js'

// Questions to start from. The label is the chip, the question is what gets asked.
export const PRESETS = [
  { label: 'How do traditions read it?', question: 'How do different Christian denominations and traditions interpret this passage?' },
  { label: 'Culture and context', question: 'Explain the cultural and historical context of this passage.' },
  { label: 'Historical evidence', question: 'Is there any historical or archaeological evidence that relates to this passage?' },
  { label: 'Original language', question: 'What do the original Hebrew, Aramaic or Greek words add to this passage?' },
  { label: 'Links to the rest of Scripture', question: 'How does this passage connect to the rest of Scripture?' },
  { label: 'Living it out', question: 'How might someone apply this passage today?' },
]

// What the AI is called in the chat.
const NAME = 'sAInt'

const SPARK =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900zM19 15l.8 2.200L22 18l-2.200.8L19 21l-.8-2.200L16 18l2.200-.8z"/></svg>'

// The answer is plain text with a little markdown: paragraphs, "- " lists, **bold**, and scripture references
// that open that verse.
export function answerNode(text, openRef) {
  const root = make('div', 'ask-text')
  const refs = (parent, chunk) => {
    for (const part of splitRefs(chunk)) {
      if (!part.ref) {
        parent.append(part.t)
        continue
      }
      const { b, c, v } = part.ref
      const link = make('button', 'ref-link', part.t)
      link.type = 'button'
      link.setAttribute('aria-label', `Go to ${refLabel(b, c, part.ref.verse ? v : undefined)}`)
      link.addEventListener('click', () => openRef(b, c, v))
      parent.append(link)
    }
  }
  // *italic* inside a chunk, as the model sometimes writes it for transliterated words
  const italics = (parent, chunk) =>
    chunk.split(/\*([^*\n]+)\*/).forEach((part, i) => {
      if (part) refs(i % 2 ? parent.appendChild(make('em')) : parent, part)
    })
  const inline = (parent, line) => {
    line.split('**').forEach((chunk, i) => {
      if (chunk) italics(i % 2 ? parent.appendChild(make('strong')) : parent, chunk)
    })
  }

  for (const block of parseAnswer(text)) {
    if (block.t === 'p') {
      inline(root.appendChild(make('p')), block.s)
    } else {
      const list = root.appendChild(make(block.t))
      for (const item of block.items) inline(list.appendChild(make('li')), item)
    }
  }
  return root
}

// An answer as blocks: { t: 'p', s } or { t: 'ul' | 'ol', items }. Models write more markdown than they were asked
// to, so this copes with the usual extras: # headings (shown as a bold line), numbered lists, bullets with blank
// lines between them, an item carried on to an indented line, hard-wrapped paragraphs, rules and tables.
export function parseAnswer(text) {
  const blocks = []
  let list = null // the open list block
  let para = null // the open paragraph block
  let blank = false

  for (const raw of text.replace(/\r/g, '').trim().split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      blank = true
      para = null
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) || /^[\s|:-]+$/.test(line)) continue // rules and table dividers

    const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/)
    const number = !bullet && line.match(/^(\s*)\d{1,2}[.)]\s+(.*)$/)
    const item = bullet || number
    if (item) {
      const t = bullet ? 'ul' : 'ol'
      if (!list || list.t !== t) blocks.push((list = { t, items: [] }))
      list.items.push(item[2].trim())
      para = null
      blank = false
      continue
    }

    const heading = line.match(/^\s*#{1,6}\s+(.*?)\s*#*$/)
    const row = line.match(/^\s*\|(.*)\|\s*$/)
    const body = heading ? `**${heading[1].replace(/\*\*/g, '')}**` : row ? row[1].split('|').map(c => c.trim()).join(' · ') : line.trim()

    if (list && !blank && /^\s{2,}/.test(line) && !heading && !row) {
      list.items[list.items.length - 1] += ` ${body}` // an item carried on
    } else if (para && !blank && !heading && !row) {
      para.s += ` ${body}` // a paragraph the model wrapped by hand
    } else {
      const block = { t: 'p', s: body }
      blocks.push(block)
      para = heading || row ? null : block // the line after a heading or a table row starts its own paragraph
      list = null
    }
    blank = false
  }
  return blocks
}

// The Ask sheet. One conversation per passage, kept for as long as the page stays open and never stored or synced.
export function initAsk({ sheet, openRef }) {
  const body = $('.sheet-body', sheet)
  const field = $('#askField', sheet)
  const send = $('#askSend', sheet)
  const note = $('.ask-note', sheet)
  const NOTE = note.textContent
  const conversations = new Map()
  let current = null // { target, turns, pending, busy, error }

  const roomy = () => body.scrollHeight - body.scrollTop - body.clientHeight < 90

  function resize() {
    field.style.height = 'auto'
    field.style.height = `${Math.max(40, Math.min(field.scrollHeight, 120))}px`
    send.disabled = !field.value.trim() || !!current?.busy
  }

  function message(who, content) {
    const li = make('li', 'cmt')
    const avatar = make('div', who === 'You' ? 'avatar' : 'avatar guide')
    if (who !== 'You') avatar.innerHTML = SPARK
    const head = make('div', 'cmt-head')
    head.append(make('strong', null, who))
    const main = make('div', 'cmt-main')
    main.append(head, content)
    li.append(avatar, main)
    return li
  }

  function chips(questions) {
    const row = make('div', 'ask-chips')
    for (const preset of questions) {
      const btn = make('button', 'ask-chip', preset.label)
      btn.type = 'button'
      btn.addEventListener('click', () => ask(preset.question))
      row.append(btn)
    }
    return row
  }

  function render() {
    const { target, turns, pending, busy, error } = current
    $('h2', sheet).replaceChildren('Ask', make('small', 'ref-sub', refLabel(target.b, target.c, target.v1, target.v2)))

    if (!turns.length) {
      const intro = make('div', 'ask-intro')
      intro.innerHTML = SPARK
      intro.append(make('p', null, 'Ask anything about this passage, or start with one of these.'), chips(PRESETS))
      body.replaceChildren(intro)
      resize()
      return
    }

    const list = make('ul', 'feed-list')
    for (const turn of turns) {
      list.append(turn.role === 'user' ? message('You', make('p', 'cmt-text', turn.content)) : message(NAME, answerNode(turn.content, openRef)))
    }
    if (busy) {
      list.append(message(NAME, pending ? answerNode(pending, openRef) : make('p', 'ask-wait', 'Thinking…')))
    }
    body.replaceChildren(list)

    if (error) {
      const note = make('div', 'ask-error')
      note.append(make('span', null, error))
      if (turns.at(-1).role === 'user') {
        const retry = make('button', 'ref-link', 'Try again')
        retry.type = 'button'
        retry.addEventListener('click', () => run(current))
        note.append(retry)
      }
      body.append(note)
    }
    if (!busy && !error && turns.at(-1).role === 'assistant') {
      const asked = new Set(turns.filter(t => t.role === 'user').map(t => t.content))
      const more = PRESETS.filter(p => !asked.has(p.question))
      if (more.length) body.append(make('p', 'ask-more', 'Ask more'), chips(more))
    }
    resize()
  }

  async function run(conv) {
    conv.busy = true
    conv.error = null
    conv.pending = ''
    if (conv === current) {
      render()
      body.scrollTop = body.scrollHeight
    }

    const refresh = () => {
      if (conv !== current) return
      const stick = roomy()
      render()
      if (stick) body.scrollTop = body.scrollHeight
    }

    try {
      const { b, c, v1, v2, text, translation } = conv.target
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book: b, chapter: c, v1, v2, passage: text, translation, turns: conv.turns }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || (res.status === 429 ? 'Too many questions. Wait a minute and try again.' : `${NAME} is not available right now.`))
      }

      const left = res.headers.get('X-Ask-Left')
      if (left != null) note.textContent = `${NOTE} ${left} ${left === '1' ? 'question' : 'questions'} left today.`

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          conv.pending += decoder.decode(value, { stream: true })
          refresh()
        }
      } catch {
        conv.error = conv.pending.trim() ? 'The connection dropped, so this answer may be cut short.' : 'The connection dropped before an answer came back.'
      }
      if (conv.pending.trim()) conv.turns.push({ role: 'assistant', content: conv.pending.trim() })
      else conv.error ||= 'No answer came back.'
    } catch (err) {
      conv.error = navigator.onLine === false ? 'You are offline.' : err.message
    } finally {
      conv.busy = false
      conv.pending = ''
      if (conv === current) {
        render()
        body.scrollTop = body.scrollHeight
      }
    }
  }

  function ask(question) {
    const text = question.trim()
    if (!text || current.busy) return
    current.turns.push({ role: 'user', content: text.slice(0, 600) })
    field.value = ''
    run(current)
  }

  function open(target) {
    const key = `${target.b}.${target.c}.${target.v1}-${target.v2}`
    if (!conversations.has(key)) conversations.set(key, { target, turns: [], pending: '', busy: false, error: null })
    current = conversations.get(key)
    current.target = target // the text on screen may now be another translation
    field.value = ''
    render()
    if (!sheet.open) sheet.showModal()
    resize()
  }

  field.maxLength = 600
  field.addEventListener('input', resize)
  field.addEventListener('keydown', event => {
    // Enter sends with a keyboard; on a phone it starts a new line and the arrow button sends.
    if (event.key === 'Enter' && !event.shiftKey && matchMedia('(pointer: fine)').matches) {
      event.preventDefault()
      ask(field.value)
    }
  })
  send.addEventListener('click', () => ask(field.value))

  return { open }
}
