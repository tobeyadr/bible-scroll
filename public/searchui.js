// The search page. Results show as a list of verses (the default) or as a feed of cards, one verse per card,
// like the reading feed. Tapping a row in the list opens the feed at that verse; back returns to the list.
// With nothing typed it shows her recent searches. Type a word, a "quoted phrase", or a reference like "john 3:16".
import { $, make } from './dom.js'
import { refLabel } from './books.js'
import { loadIndex, lookup, parseQuery, parseReference, search, isEmptyQuery, snippet } from './search.js'
import { remember, forget, readList } from './searchhistory.js'

const BATCH = 20 // feed cards added at a time as she scrolls
const ROWS = 40 // list rows added at a time

// What is on screen: a status card ('status'), her recent searches ('history'), or the results ('list' | 'feed').
// getSource() is the translation to search (the one being read, if it is bundled): { id, book(b) }.
export function initSearch({ page, getSource, renderResult, fit, go, store }) {
  const field = $('#searchField', page)
  const results = $('#searchResults', page) // the feed, and the status cards
  const list = $('#searchList', page) // the list, and her recent searches
  const meta = $('#searchMeta', page)
  const refBtn = $('#searchRef', page)
  const viewBtn = $('#searchView', page)

  let index = null // every verse of the translation in `indexId`, once all the books have been read
  let indexId = null
  let loading = null
  let progress = 0
  let hits = []
  let shown = 0 // feed cards built
  let rows = 0 // list rows built
  let query = null
  let timer
  let mode = 'status'
  let view = store.get('searchView', 'list') === 'feed' ? 'feed' : 'list' // her choice, kept
  let fromRow = false // the feed was opened from a list row, so back goes to the list
  let recent = readList(store.get('searches', []))

  const isOpen = () => !page.hidden

  function setMode(next) {
    mode = next
    page.dataset.mode = next
    results.hidden = next === 'list' || next === 'history'
    list.hidden = !(next === 'list' || next === 'history')
    viewBtn.setAttribute('aria-label', next === 'feed' ? 'Show as a list' : 'Show as a feed')
  }

  // Builds the index for the translation being searched; starts over if she has switched translation.
  function ensureIndex() {
    const src = getSource()
    if (indexId === src.id) return
    indexId = src.id
    index = null
    progress = 0
    const mine = (loading = loadIndex(src.book, done => {
      if (loading !== mine) return
      progress = done
      if (isOpen()) render()
    })
      .then(verses => {
        if (loading === mine) index = verses
      })
      .catch(() => {
        if (loading === mine) indexId = null // so "Try again" loads it again
      })
      .finally(() => {
        if (loading !== mine) return
        loading = null
        if (isOpen()) render()
      }))
  }

  const statusCard = (title, message, action) => {
    const sec = make('section', 'card note')
    if (title) sec.append(make('h3', null, title))
    if (message) sec.append(make('p', null, message))
    if (action) {
      const btn = make('button', 'btn', action.label)
      btn.addEventListener('click', action.run)
      sec.append(btn)
    }
    return sec
  }

  function showStatus(card) {
    setMode('status')
    results.replaceChildren(card)
  }

  // ---------- history ----------

  const saveRecent = () => store.set('searches', recent)

  // Searches that found something are kept, when she opens a verse, presses Enter or leaves.
  function commit() {
    if (hits.length || parseReference(field.value)) {
      recent = remember(recent, field.value)
      saveRecent()
    }
  }

  function showRecent() {
    if (!recent.length) {
      return showStatus(statusCard('Search the Bible', 'Type a word or a “quoted phrase”, or a passage like John 3:16.'))
    }
    setMode('history')
    const head = make('div', 'recent-head')
    const clear = make('button', null, 'Clear')
    clear.dataset.clear = '1'
    head.append(make('span', null, 'Recent searches'), clear)
    const items = recent.map(text => {
      const row = make('div', 'recent')
      const run = make('button', 'recent-q')
      run.dataset.q = text
      run.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.500V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      run.append(make('span', null, text))
      const x = make('button', 'recent-x')
      x.dataset.forget = text
      x.setAttribute('aria-label', `Remove ${text}`)
      x.textContent = '×'
      row.append(run, x)
      return row
    })
    list.replaceChildren(head, ...items)
    list.scrollTop = 0
  }

  // ---------- the list ----------

  function renderRow(verse, i) {
    const ref = refLabel(verse.b, verse.c, verse.v)
    const row = make('div', 'hit')
    row.dataset.i = i
    // Tapping the row opens the results as a feed at this verse; "Read" opens the verse in its chapter.
    const main = make('button', 'hit-main')
    main.append(make('span', 'hit-ref', ref))
    const text = make('span', 'hit-text')
    for (const seg of snippet(verse.text, query, 110)) text.append(seg.hit ? make('mark', null, seg.t) : seg.t)
    main.append(text)
    const read = make('button', 'hit-read', 'Read ›')
    read.setAttribute('aria-label', `Read from ${ref}`)
    row.append(main, read)
    return row
  }

  function addRows(upTo = rows + ROWS) {
    const next = hits.slice(rows, Math.min(upTo, hits.length)).map((verse, k) => renderRow(verse, rows + k))
    rows += next.length
    list.append(...next)
  }

  // The first row under the search bar, so switching views keeps her place.
  const firstRow = () => Math.max(0, [...list.children].findIndex(row => row.offsetTop + row.offsetHeight > list.scrollTop + 110))

  // ---------- the feed ----------

  function addCards() {
    const nodes = hits.slice(shown, shown + BATCH).map(verse => renderResult(verse, query))
    shown += nodes.length
    results.append(...nodes)
    nodes.forEach(fit)
  }

  const feedIndex = () => Math.round(results.scrollTop / results.clientHeight)

  // Build the feed far enough to show verse `at`, and scroll to it.
  function showFeedAt(at) {
    setMode('feed')
    results.replaceChildren()
    shown = 0
    while (shown < Math.min(at + BATCH, hits.length)) addCards()
    results.scrollTop = at * results.clientHeight
    showPosition()
  }

  function showListAt(at) {
    setMode('list')
    addRows(at + ROWS)
    list.children[at]?.scrollIntoView({ block: 'start' })
    showPosition()
  }

  function showPosition() {
    if (!hits.length) return
    const count = hits.length === 1 ? 'verse' : 'verses'
    if (mode === 'list') {
      meta.textContent = `${hits.length.toLocaleString()} ${count}`
      return
    }
    if (mode !== 'feed') return
    const at = Math.min(hits.length, feedIndex() + 1)
    meta.textContent = `${at} of ${hits.length.toLocaleString()} ${count}`
    if (shown < hits.length && at + 6 >= shown) addCards()
  }

  // From the list into the feed at one verse. The phone's back gesture returns to the list.
  function openRow(at) {
    commit()
    field.blur()
    history.pushState({ search: 2 }, '')
    fromRow = true
    showFeedAt(at)
  }

  // Back from a feed that was opened from the list (called from the back gesture or button).
  function backToList() {
    if (!fromRow) return
    fromRow = false
    const at = feedIndex()
    showListAt(at)
  }

  // ---------- rendering ----------

  function render() {
    if (fromRow) {
      // A new search while reading a result: drop the extra history entry the row added.
      fromRow = false
      history.back()
    }
    const raw = field.value
    const ref = parseReference(raw)
    query = parseQuery(raw)
    hits = []
    shown = 0
    rows = 0
    meta.textContent = ''
    results.scrollTop = 0
    list.scrollTop = 0

    refBtn.hidden = !ref
    if (ref) {
      refBtn.textContent = `Go to ${ref.verse ? refLabel(ref.b, ref.c, ref.v) : refLabel(ref.b, ref.c)} ›`
      refBtn.onclick = () => jump(ref)
    }

    if (isEmptyQuery(query) || query.terms.join('').length + query.phrases.join('').length < 2) return showRecent()
    if (!index) {
      return showStatus(
        loading
          ? statusCard('Getting the Bible ready…', `${Math.round((progress / 66) * 100)}%`)
          : statusCard("Couldn't load the Bible text", 'Check your connection.', {
              label: 'Try again',
              run: () => {
                ensureIndex()
                render()
              },
            }),
      )
    }

    if (ref?.chapter) {
      // A passage like "john 3:16" or "ps 23" brings up those verses themselves, with nothing highlighted.
      hits = lookup(index, ref)
      query = parseQuery('')
    } else {
      hits = search(index, query)
    }
    if (!hits.length) return showStatus(statusCard('No verses found', `Nothing matches “${raw.trim()}”.`))

    list.replaceChildren()
    results.replaceChildren()
    if (view === 'feed') showFeedAt(0)
    else showListAt(0)
  }

  function jump(item) {
    commit()
    close()
    go(item.b, item.c, item.v)
  }

  function open(text) {
    if (isOpen()) {
      // Already searching (a word picked from a result): search for it here.
      if (text != null) {
        field.value = text
        clearTimeout(timer)
        render()
      }
      return
    }
    ensureIndex()
    history.pushState({ search: 1 }, '') // the phone's back gesture closes search instead of leaving the app
    page.hidden = false
    // A word picked from a verse shows its results straight away, with the keyboard left down.
    // Otherwise start empty, which shows her recent searches.
    field.value = text ?? ''
    render()
    if (text == null) {
      field.focus()
      field.select()
    }
  }

  function hide() {
    if (!isOpen()) return
    page.hidden = true
    fromRow = false
    field.blur()
  }

  // Closing from the screen steps back through the history entries that were added.
  function close() {
    if (!isOpen()) return
    if (hits.length) commit()
    if (history.state?.search) history.go(fromRow ? -2 : -1)
    hide()
  }

  // The arrow, Escape: out of an opened verse to the list, otherwise out of search.
  const back = () => (mode === 'feed' && fromRow ? history.back() : close())

  addEventListener('popstate', () => {
    if (!isOpen()) return
    const level = history.state?.search
    if (!level) hide()
    else if (level === 1) backToList()
  })

  let frame = 0
  const onScroll = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (mode === 'list' && rows < hits.length && list.scrollTop + list.clientHeight > list.scrollHeight - 1200) addRows()
      showPosition()
    })
  }
  results.addEventListener('scroll', onScroll, { passive: true })
  list.addEventListener('scroll', onScroll, { passive: true })

  list.addEventListener('click', event => {
    const hit = event.target.closest('.hit')
    if (hit) return event.target.closest('.hit-read') ? jump(hits[+hit.dataset.i]) : openRow(+hit.dataset.i)
    const run = event.target.closest('[data-q]')
    if (run) {
      field.value = run.dataset.q
      clearTimeout(timer)
      return render()
    }
    const forgetBtn = event.target.closest('[data-forget]')
    if (forgetBtn) {
      recent = forget(recent, forgetBtn.dataset.forget)
      saveRecent()
      return showRecent()
    }
    if (event.target.closest('[data-clear]')) {
      recent = []
      saveRecent()
      showRecent()
    }
  })

  viewBtn.addEventListener('click', () => {
    if (mode === 'list') {
      view = 'feed'
      store.set('searchView', view)
      showFeedAt(firstRow())
    } else if (mode === 'feed') {
      view = 'list'
      store.set('searchView', view)
      if (fromRow) history.back() // the popstate handler shows the list
      else showListAt(feedIndex())
    }
  })

  field.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(render, 150)
  })

  field.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    clearTimeout(timer)
    const ref = parseReference(field.value)
    if (ref) jump(ref)
    else {
      render()
      commit()
      field.blur() // put the keyboard away to read the results
    }
  })

  page.addEventListener('keydown', event => {
    if (event.key === 'Escape') back()
  })
  $('#searchBack', page).addEventListener('click', back)

  return { open, close, isOpen }
}
