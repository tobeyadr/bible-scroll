# Pictures for the Illustrated theme

`images.json` is the whole plan: a shared **style**, and one entry per picture with the passages it sits behind and a **prompt** for the subject. 156 pictures: one per book (`book-<name>`, 66) and 90 moments.

## How a picture is chosen

Each entry lists `refs`: a whole book (`"Genesis"`), a chapter (`"Genesis 7"`), chapters (`"Matthew 5-7"`), verses (`"Genesis 11:1-9"`) or a run across chapters (`"Genesis 6:9-9:17"`). A card shows the **narrowest** entry that covers its first verse, so the book picture is the default and a moment overrides it. A moment can have several refs (the four Gospel accounts of the same scene share one picture). Book names are the ones in `public/books.js` (`Psalms`, not `Psalm`).

## Adding or changing a moment

1. Add an entry to `images.json` with an `id` (lowercase words with dashes), the `refs` and a `prompt` that describes the subject only. The style is added for you.
2. Make the picture (see below) and save it as `public/art/<id>.webp`.
3. `node scripts/build-art-manifest.mjs` writes `public/art/manifest.json`, which lists only the pictures that exist.
4. `npm test` checks that every ref is a real passage with real verses, that no passage is given to two pictures, and that every moment wins over its book picture.

## Making the pictures

Size 1080 × 1920 (9:16), WebP, aiming for 100–200 KB each. The first batch is the entries marked `"pilot": true`: make those first to settle the look before spending on the rest. Any image tool works as long as the result is saved into `public/art/`; nothing in the app depends on how a picture was made. Changing a picture's file changes its `?v=` in the manifest, which is what makes phones fetch the new one.

## House rules for the pictures

- Painterly, muted and low contrast, with the focal point in the upper half and calmer shapes below, because text sits over the picture (and a dark wash is laid over it in the app).
- People are simplified and seen from behind, at a distance or in silhouette, with no detailed faces. Faces are where AI images are least consistent, and not drawing them keeps the pictures reverent for readers of any tradition.
- God is never drawn as a person; use light, cloud, fire or wind. Nothing graphic: the crucifixion is shown as three crosses in silhouette on a distant hill.
- No lettering or writing of any kind in the image.

The pictures need their own licence note in the main README once they exist (AI-made images may not be copyrightable, and each tool has its own terms).
