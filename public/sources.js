// Where each translation's chapter text comes from. Every source resolves to the plain-text shape
// that parse.js understands: paragraphs split by blank lines, poetry as indented lines, "[12]" verse marks.

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// The bundled translations ship as one static file per book (/<dir>/<book index>.json), fetched on demand
// and kept for the session.
function bundledBook(dir) {
  const books = new Map()
  return b => {
    if (!books.has(b)) {
      const request = getJson(`/${dir}/${b}.json`)
      request.catch(() => books.delete(b))
      books.set(b, request)
    }
    return books.get(b)
  }
}

const bsbBook = bundledBook('bsb')
const kjvBook = bundledBook('kjv')
const webBook = bundledBook('web')
const esvBook = bundledBook('esv')

export const SOURCES = {
  BSB: {
    id: 'BSB',
    mark: 'BSB',
    name: 'Berean Standard Bible',
    book: bsbBook,
    notice:
      'The Holy Bible, Berean Standard Bible, BSB, is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.info, and the Berean Bible Translation Committee. This text of God’s Word has been dedicated to the public domain.',
    text: async (b, c) => (await bsbBook(b))[c - 1],
  },
  KJV: {
    id: 'KJV',
    mark: 'KJV',
    name: 'King James Version',
    book: kjvBook,
    notice: 'The Holy Bible, King James Version (Authorized Version), is in the public domain in the United States. In the United Kingdom the text is held by the Crown under letters patent.',
    text: async (b, c) => (await kjvBook(b))[c - 1],
  },
  WEB: {
    id: 'WEB',
    mark: 'WEB',
    name: 'World English Bible',
    book: webBook,
    notice: 'The Holy Bible, World English Bible (WEB), is in the public domain. “World English Bible” is a trademark of Michael Paul Johnson, who asks that the name not be used for altered text.',
    text: async (b, c) => (await webBook(b))[c - 1],
  },
  // The ESV through Crossway's API, by way of the Worker's /api/passage proxy (the key stays on the server).
  // It needs a connection and cannot be searched, since the app never holds the whole text.
  ESV: {
    id: 'ESV',
    mark: 'ESV®',
    name: 'English Standard Version',
    notice:
      'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. The ESV text may not be quoted in any publication made available to the public by a Creative Commons license. The ESV may not be translated into any other language.',
    text: async (b, c) => (await getJson(`/api/passage?book=${b}&chapter=${c}`)).text,
  },
  // An ESV copy you bundle yourself as files in public/esv/ (one JSON array of chapter texts per book, in the shape of
  // public/bsb/), for personal use: works offline and can be searched. The repository ships no text for it, so it is
  // not in ENABLED. "(L)" is for local.
  'ESV(L)': {
    id: 'ESV(L)',
    mark: 'ESV® (local)',
    name: 'English Standard Version (local copy)',
    book: esvBook,
    notice:
      'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. All rights reserved. For personal use only.',
    text: async (b, c) => (await esvBook(b))[c - 1],
  },
}
