# Pictures for the Illustrated theme

`images.json` is the whole plan: a shared **style**, and one entry per picture with the passages it sits behind and a **prompt** for the subject. 156 pictures: one per book (`book-<name>`, 66) and 90 moments. The Worker paints them on demand (see "Illustrated theme" in the main README); nothing here is a picture itself.

## How a picture is chosen

Each entry lists `refs`: a whole book (`"Genesis"`), a chapter (`"Genesis 7"`), chapters (`"Matthew 5-7"`), verses (`"Genesis 11:1-9"`) or a run across chapters (`"Genesis 6:9-9:17"`). A card shows the **narrowest** entry that covers its first verse, so the book picture is the default and a moment overrides it. A moment can have several refs (the four Gospel accounts of the same scene share one picture). Book names are the ones in `public/books.js` (`Psalms`, not `Psalm`).

## Adding or changing a moment

1. Add an entry to `images.json` with an `id` (lowercase words with dashes), the `refs` and a `prompt` that describes the subject only. The style is added for you.
2. Deploy. The picture is painted the first time someone scrolls to it. To change one that already exists, use Redo on its card, or edit the prompt and then Redo.
3. `npm test` checks that every ref is a real passage with real verses, that no passage is given to two pictures, and that every moment wins over its book picture.

## What gets painted

Size 1024 × 1536 (2:3 portrait), WebP where the API offers it. The first batch to judge the look is the entries marked `"pilot": true`: scroll to those first, and adjust the style before spending on the rest. Pictures are stored in D1 (table `art_image`), not in the repository.

## House rules for the pictures

- Painterly, muted and low contrast, with the focal point in the upper half and calmer shapes below, because text sits over the picture (and a dark wash is laid over it in the app).
- People are simplified and seen from behind, at a distance or in silhouette, with no detailed faces. Faces are where AI images are least consistent, and not drawing them keeps the pictures reverent for readers of any tradition.
- God is never drawn as a person; use light, cloud, fire or wind. Nothing graphic: the crucifixion is shown as three crosses in silhouette on a distant hill.
- No lettering or writing of any kind in the image.

Each image tool has its own terms, and AI-made images may not be copyrightable; check the provider's terms before relying on the pictures.
