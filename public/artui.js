import { make } from './dom.js'
import { compileArt, pickArt, artUrl } from './art.js'

// The picture behind each card in the Illustrated theme. Nothing is fetched in other themes, and a card with no
// picture (none listed, not generated yet, or offline for the first time) simply keeps its plain background.
export function createArt({ isOn }) {
  let entries = null // the compiled manifest, once fetched
  const ready = new Map() // image url -> Promise<boolean>, so each picture is loaded once

  function list() {
    entries ??= fetch('/art/manifest.json')
      .then(res => {
        if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`)
        return res.json()
      })
      .then(compileArt)
      .catch(() => {
        entries = null // try again next time
        return []
      })
    return entries
  }

  // Loaded before it is shown, so a card never flashes a broken or half-drawn image.
  function load(url) {
    if (!ready.has(url)) {
      ready.set(
        url,
        new Promise(resolve => {
          const img = new Image()
          img.onload = () => resolve(true)
          img.onerror = () => resolve(false)
          img.src = url
        }).then(ok => {
          if (!ok) ready.delete(url)
          return ok
        }),
      )
    }
    return ready.get(url)
  }

  const saveData = () => !!navigator.connection?.saveData

  async function attach(sec) {
    const mine = (sec.artFor = {})
    sec.classList.remove('art-on')
    sec.querySelector(':scope > .art')?.remove()
    if (!isOn() || saveData()) return

    const img = pickArt(await list(), +sec.dataset.b, +sec.dataset.c, +sec.dataset.v1)
    if (!img || sec.artFor !== mine || !isOn()) return
    const url = artUrl(img)
    if (!(await load(url)) || sec.artFor !== mine || !isOn()) return

    const layer = make('div', 'art')
    layer.style.backgroundImage = `url("${url}")`
    layer.setAttribute('aria-hidden', 'true')
    sec.prepend(layer)
    requestAnimationFrame(() => sec.classList.add('art-on'))
  }

  return {
    attach,
    // After the theme changes: add pictures to the cards on screen, or take them away.
    refresh: () => document.querySelectorAll('.card:not(.note)').forEach(attach),
    // Whether any pictures ship at all, so Settings only offers the theme when there is something to show.
    available: () => list().then(found => found.length > 0),
  }
}
