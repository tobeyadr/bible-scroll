// Writes public/art/manifest.json, the list the Illustrated theme reads, from art/images.json.
//
//   node scripts/build-art-manifest.mjs
//
// Only images whose file exists in public/art/ are listed, so the app never asks for a picture that is not there
// and the theme stays hidden until some pictures exist. Each picture's address carries a short hash of the file
// (?v=...), which is what makes the service worker fetch a picture again after it has been replaced.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const ART = new URL('public/art/', ROOT)

// The manifest for a set of images: one { ref, img } per passage of each image that has a file. `version(id)`
// returns the file's hash, or null when there is no file. Books come first, so the more specific entries are
// later in the list (the app picks the narrowest match anyway, and a later entry wins a tie).
export function buildManifest(images, version) {
  const art = []
  for (const image of images) {
    const v = version(image.id)
    if (v == null) continue
    for (const ref of image.refs) art.push({ ref, img: `${image.id}.webp?v=${v}` })
  }
  return { art }
}

function main() {
  const { images } = JSON.parse(readFileSync(new URL('art/images.json', ROOT), 'utf8'))
  const manifest = buildManifest(images, id => {
    const file = new URL(`${id}.webp`, ART)
    return existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8) : null
  })
  mkdirSync(ART, { recursive: true })
  writeFileSync(new URL('manifest.json', ART), `${JSON.stringify(manifest, null, 1)}\n`)
  const have = new Set(manifest.art.map(e => e.img.split('?')[0]))
  console.log(`${have.size} of ${images.length} pictures present, ${manifest.art.length} passages listed`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) main()
