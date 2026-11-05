import { make } from './dom.js'
import { compileArt, pickArt, artUrl } from './art.js'

// The picture behind each card in the Illustrated theme. Pictures are painted on demand by the Worker
// (src/art.js), so a card asks for its picture, waits as long as the Worker needs the first time, and fades it in
// when it arrives. Nothing is asked for in other themes, and a card with no picture keeps its plain background.
const WAIT_MIN = 4000
const WAIT_MAX = 60000
const TRIES = 14 // 202 (still being painted) or 429 (slow down): ask again, this many times at most
const COOLDOWN = 60000 // after giving up on a picture, leave it alone this long

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export function createArt({ isOn }) {
  let plan = null // Promise<{ entries, versions }>
  const pictures = new Map() // id -> { promise: Promise<object url | null>, failedAt }

  function load() {
    plan ??= fetch('/api/art/plan')
      .then(res => {
        if (!res.ok) throw new Error(`plan: HTTP ${res.status}`)
        return res.json()
      })
      .then(body => ({ entries: compileArt(body), versions: body.versions ?? {} }))
      .catch(() => {
        plan = null // try again next time
        return { entries: [], versions: {} }
      })
    return plan
  }

  // One request per picture however many cards use it. The first view of a picture can take a while, because the
  // Worker paints it before answering; anything else that asks meanwhile is told to try again shortly.
  function picture(id, versions) {
    const known = pictures.get(id)
    if (known && !(known.failedAt && Date.now() - known.failedAt > COOLDOWN)) return known.promise
    const entry = { promise: null, failedAt: 0 }
    entry.promise = (async () => {
      const url = artUrl(id, versions[id] ?? 0)
      for (let attempt = 0; attempt < TRIES; attempt++) {
        let res
        try {
          res = await fetch(url)
        } catch {
          break
        }
        if (res.status === 200) {
          const version = Number(res.headers.get('X-Art-Version'))
          if (version) versions[id] = version
          return URL.createObjectURL(await res.blob())
        }
        if (res.status !== 202 && res.status !== 429) break
        const wait = Number(res.headers.get('Retry-After')) * 1000 || WAIT_MIN
        await sleep(Math.min(Math.max(wait, WAIT_MIN), WAIT_MAX))
      }
      entry.failedAt = Date.now()
      return null
    })()
    pictures.set(id, entry)
    return entry.promise
  }

  const saveData = () => !!navigator.connection?.saveData

  function clear(sec) {
    sec.classList.remove('art-on')
    sec.querySelector(':scope > .art')?.remove()
    sec.querySelector('[data-act="redo"]')?.setAttribute('hidden', '')
    delete sec.artId
  }

  async function attach(sec) {
    const mine = (sec.artFor = {})
    if (!isOn() || saveData()) return clear(sec)

    const { entries, versions } = await load()
    if (sec.artFor !== mine) return
    const id = pickArt(entries, +sec.dataset.b, +sec.dataset.c, +sec.dataset.v1)
    if (!id) return clear(sec)

    const url = await picture(id, versions)
    if (!url || sec.artFor !== mine || !isOn()) return // nothing to show; any picture already there stays

    const layer = make('div', 'art')
    layer.style.backgroundImage = `url("${url}")`
    layer.setAttribute('aria-hidden', 'true')
    const old = sec.querySelector(':scope > .art')
    if (old) {
      old.replaceWith(layer) // a redone picture: the card is already lit, so it just changes
    } else {
      sec.prepend(layer)
      requestAnimationFrame(() => sec.classList.add('art-on'))
    }
    sec.artId = id
    sec.querySelector('[data-act="redo"]')?.removeAttribute('hidden')
  }

  const cards = () => [...document.querySelectorAll('.card:not(.note)')]

  return {
    attach,
    // After the theme changes: add pictures to the cards on screen, or take them away.
    refresh: () => cards().forEach(attach),
    // Whether there is anything to show, so Settings only offers the theme when there is.
    available: () => load().then(({ entries }) => entries.length > 0),
    // Asks the Worker to paint a new picture for this card's scene, then swaps it in on every card that shows it.
    async redo(sec) {
      const id = sec.artId
      if (!id) throw new Error('There is no picture here to redo.')
      const res = await fetch(`/api/art/${id}/regenerate`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.status === 202) throw new Error('That picture is already being made. Try again in a minute.')
      if (!res.ok) throw new Error(body.error || 'The picture could not be made right now.')
      const { versions } = await load()
      versions[id] = body.version
      const old = pictures.get(id)
      pictures.delete(id)
      old?.promise.then(url => url && setTimeout(() => URL.revokeObjectURL(url), 5000))
      cards().filter(card => card.artId === id).forEach(attach)
    },
  }
}
