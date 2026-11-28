# Changelog

Every release is a git tag (vX.Y.Z) with a GitHub release that cannot change after it is published. What each
number means is in README.md ("Versions").

## 1.11.0

The colours of eyes that an expression closes or half closes, from a review of every expression on every face shape in
the three eye colours. Every seed keeps its selection (test/identity.txt is unchanged); avatars with blue or green eyes
in "Air kiss", "Laugh", "Sad", "Sleepy", "Closed smile", "Smirk" or "Wink", and the man's "Face 6" in the neutral
expression, change, and some of them in skin tones other than 4, in every eye colour.

- A blue or green iris no longer spills over the lids at the corners of an eye ("Wink", "Sad", "Laugh"), and no longer
  ends in a hard, flat edge: the image model's iris of that colour is moved onto the iris the expression shows, and
  kept inside it.
- Under a dark skin tone the lid beside such an eye no longer keeps a light patch (the woman's "Face 3" winking, in
  tone 9).
- The highlight in the eye stays white, as the expression has it: the model's highlight of the eye colour, often grey
  or cut square, is painted over ("Wink", "Laugh", "Air kiss").
- "Sleepy": the iris reaches up to the lashes, as large as the dark brown one, with an even upper edge, in the shade
  of the lid.
- Avatar files: build c0ab703c09b6 (the layers of those expressions, the mask of one face shape, and the manifest);
  the engine is that of 1.10.0.

## 1.10.0

How hair and the beanie and the cap go together, from a review of every hairstyle under them. Every seed keeps its
selection (test/identity.txt is unchanged); avatars with a beanie or a cap and hair change, and no other avatar does.

- Over hair the beanie sits on the hair, as the image model draws it: its edge over the forehead about 45 px higher
  (in a 1024 px frame), and its sides ending above the ears instead of coming down over them to the jaw. The hair
  comes out from under it all round the face: on the forehead, beside the cheeks and over the shoulders. On a bald
  head the beanie is as before.
- No hair shows outside the outline of the beanie or the cap above the lower edge of each side of the hat. Hair
  shown there hung behind the hat: beside the beanie's sides ("Afro puffs", "Short locs", curls) and beside the lower
  corners of the cap.
- Below that edge the hair comes out from under the hat: hair that lay further out is pressed in towards the head,
  row by row, and widens as it falls, within a curve that leaves the edge straight down.
- Short hair at a side of the cap is pressed down by the cap until its ends come out as small tufts below its lower
  corners ("Pixie", and the man's short haircuts). Long hair stays as it is.
- Under the beanie a lock that hangs over the forehead comes out from under it ("Short twists"); smaller pieces over
  the forehead (the tip of a curl or of a single lock) stay hidden, under both hats.
- Hair that comes out from under the beanie or the cap takes half of the hat's shadow. In all of it the tips of a
  fringe under a cap's brim read as shadow and not as hair ("Pixie", "Bob with bangs").
- Avatar files: build d7569e08bfa7 (the engine and the manifest's build); the files of an avatar are those of 1.9.0.

## 1.9.0

Six more skin tones and a fifth hair colour, light brown, as choices by name only: `options()` lists them and an
override picks them, but seeds do not draw them, so every seed keeps its selection (test/identity.txt is unchanged).

- Skin tones `1`, `3`, `5`, `6`, `8` and `10` join `2`, `4`, `7` and `9`: ten tones in order from very fair (`1`) to
  very deep (`10`), on both templates and every face shape and expression. Like `2`, `7` and `9`, each is a colour
  map of the skin taken from the image model's own render of the face in that tone; a tone whose lightness or colour
  strength came out off its place between its neighbours was moved there.
- Hair colour `lightbrown`: every hairstyle of both templates (16 and 15) has the image model's own light brown
  version, and so do 43 of the 53 beards of the six face shapes. The other 10, like every stubble, are coloured by the
  engine from the dark brown beard, as it colours a stubble golden or ginger.
- Avatar files: build 1f1e3a13b0f0 (176 files written and 24 removed, at both sizes). The light brown version of a
  beard is in the file of its golden and ginger versions (`<beard>.light`), and the two stubbles of a face shape are
  now one file (`stubble`), so there are 12 files fewer. Those files were encoded again: their pixels differ from 1.8.0
  by at most 14 levels of 255 (0.3 on average), which does not show.
- An avatar with a golden or ginger beard now also fetches the light brown version (typically 26 KB more at full
  size, at most 155 KB), and one with stubble the other stubble (30 to 51 KB more). Over the seeds `seed0` to
  `seed999` the files of an avatar are 1.4% larger on average at full size and 0.9% at 512 px and below: 0.10 to
  0.51 MB (0.26 MB typical) at 512 px and below, 0.16 to 1.32 MB (0.55 MB typical) above. `manifest.json` grows from
  350 KB to 378 KB. README.md now gives the size of the code as 135 KB (125 KB was its size in 1.4.0).

## 1.8.0

A correction of the rule in 1.7.0 that takes the grey shadow of long hair off the shoulders: it took too much and
left too much. Every seed keeps its selection (test/identity.txt is unchanged).

- In 1.7.0 the shadow that the image model drew of the hair on the template's white t-shirt left a faint outline and a
  few specks where it had been (most of all below the ends of "Shoulder-length lob"), and the rule took two grey
  sheens inside "Half-up with a bun" for shadow too: small holes, white over a light garment. Now only what the
  model's own golden blonde and copper ginger versions of the hairstyle left as it was counts as shadow, with its soft
  rim; the sheens are hair again. The same 12 hairstyles as in 1.7.0 change, in every hair colour.
- Avatar files: build 9262db478fa8 (at both sizes the 48 files of those hairstyles, three colour maps and the
  manifest). The files of an avatar are the size they were in 1.7.0, which made them about 4% larger than 1.6.0 on
  average, more than its note said: at 512 px and below 0.10 to 0.47 MB (0.26 MB typical), above 0.16 to 1.17 MB
  (0.55 MB typical).

## 1.7.0

Four fixes, all in how avatars look. Every seed keeps its selection (test/identity.txt is unchanged).

- Garments beside the jaw. On the young woman's face shapes whose chin comes lower than the template's (above all
  "Face 2", by about 40 px; faces 5 and 6 by about 15 px, face 3 by 3 px), the tips of the hoodie's hood and the
  points of the button-up shirt's collar ran into the jaw and were cut by it. A garment that reaches the jaw now
  follows the chin of the face shape, and what still rises above the chin line lies behind the jaw, so the line of
  the jaw is the one the model drew. The plain T-shirt, and every garment of the man, are as before.
- Long hair over the shoulders. Hair that rests on the shoulders was cut across by a seam, or zigzagged, in face shapes
  other than the template's and in many expressions ("Shoulder-length lob", "Long straight", "Long curly", "Half-up",
  "Box braids", the man's "Long wavy" and others): the engine took the template's own white t-shirt, under every
  garment, for skin, and hair beside the face lies behind the skin. Now only the skin counts, so hair over the
  shoulders lies over the garment. Where long hair passes behind the jaw (for example "Long straight" on "Face 2"),
  the hair fills the opening without a see-through band or a light rim.
- Grey patches on the shoulders. In 12 long hairstyles the image model had drawn the shadow of the hair on the
  template's white t-shirt, and it showed as a grey patch over every garment (most of all below the ends of
  "Shoulder-length lob"). The hair layers no longer hold it, in every hair colour.
- Blue and green eyes in "Sleepy" were flat and blocky in all 12 face shapes. They now come from the iris the image
  model drew on the open eye of the same face, set where the sleepy eye shows its iris and shaded by its heavy lids.
- Avatar files: build e836965a98cb (at both sizes: the 48 files of those hairstyles, the 12 face files, which now
  also mark the face image's own t-shirt, the 12 files of "Sleepy", three colour maps and the manifest). The files
  of an avatar grow by about 2.5% on average (0.25 MB typical at 512 px and below, 0.54 MB above).

## 1.6.0

The goatee of the man's fifth face shape ("Face 5") is now like the goatee of the other faces: a small patch under the
lip and the beard on the chin. In 1.5.0 it was a small pointed tuft. Every seed keeps its selection
(test/identity.txt is unchanged), so an avatar changes only if it is the man with face 5 and the goatee.

- The image model drew it in the same run as the goatee of 1.5.0 (the other image of the same face), and in golden
  blonde and copper ginger too.
- Avatar files: build d01c06cd863d (at both sizes the file of face 5's goatee and the file of its light colours, and
  the manifest).

## 1.5.0

"Goatee" is now a goatee: hair on the chin only. Up to 1.4.0 it was drawn as a goatee joined to a mustache around the
mouth, and on two of the face shapes also along the jaw. That beard stays, under a name that says what it shows:
`goatee_mustache` ("Goatee with mustache"). Every seed keeps its selection (test/identity.txt is unchanged), so an
avatar changes only if its beard is "goatee": it now has the goatee on the chin.

- The new goatee was drawn by the image model on each of the 6 face shapes, in golden blonde and copper ginger too.
  The model drew a separate mustache with it every time; the layer takes only the hair below the mouth, and the face
  shows above it as it is.
- `goatee_mustache` is chosen only by name: `options()` lists it and an override picks it
  (`{ beard: 'goatee_mustache' }`), but seeds do not draw it, so no seed changes its selection. A major version can
  bring it into the draw (README.md, "Versions"). Its files are those of "goatee" in 1.4.0, and it renders as
  "goatee" did, to the pixel.
- The light colours of a beard come in one file: a beard's golden and ginger recolours, with the shadow of the dark
  brown beard once, in `l/<beard>.light.webp` (53 files at each size instead of 106; the demo page of the factory
  holds at most 512 files). A render with a golden or ginger beard fetches that one file: at full size 118 KB on
  average instead of 64 KB, at half size 40 KB instead of 22 KB. Over the seeds `seed0` to `seed999` the files of an
  avatar grow by 0.4% on average at 512 px (median 0.24 MB as before, the largest 0.46 MB instead of 0.43 MB), and by
  0.5% above 512 px. The light colours are encoded again in their new place, so a golden or ginger beard differs from
  1.4.0 by the coding only (a PSNR of at least 41 dB); every other file is the same, byte for byte.
- Avatar files: build 31388cf0a56b (at both sizes: the files of "goatee", the new files of `goatee_mustache`, the
  files of the light colours, and the manifest; the 188 files of the light colours one by one are gone).

## 1.4.0

Small avatars are much faster: a render at 512 px or less now loads a second set of the layer files at half size
and composes at 512, instead of loading the full-size files and composing at 1024. Every seed keeps its choices
(test/identity.txt is unchanged), and at full size every selection renders exactly as in 1.3.0 (the browser test
checks 137 renders to the pixel).

- At 512 px, measured as in 1.3.0 (bench/results.md: 12 seeds, 0.3 s per file): a first avatar takes 0.85 s instead
  of 1.15 s, its files are 61% smaller, decoding takes 301 ms instead of 741 ms, and a render with the files at hand
  takes 112 ms instead of 448 ms (composing 144 ms instead of 411 ms).
- Avatars at 512 px and below look the same, but they are composed from the smaller files, so they are not identical
  to 1.3.0's to the pixel: against 1.3.0 at 512 px the difference is about 34 to 40 dB of PSNR once the frames are
  aligned, and the avatar sits half a pixel lower (the frame shift of 49 px at 1024 is 25 px at 512, not 24.5). The
  browser test bounds the difference.
- The avatar files load from jsDelivr's npm route by default: `CDN_BASE` is
  `https://cdn.jsdelivr.net/npm/pixitoons@<version>/assets/` (up to 1.3.0, the GitHub release:
  `https://cdn.jsdelivr.net/gh/pixitoons/pixitoons@v<version>/assets/`). With both sizes of files the repository is
  more than the 50 MB jsDelivr serves from a GitHub tag (55.5 MB); the npm package is 54 MB of the 150 MB allowed
  there. The code of a site that uses the default does not change; the direct CDN import in the README is now
  `https://cdn.jsdelivr.net/npm/pixitoons@<version>/src/index.js`.
- `files()` and `preload()` take `size`, for the files of renders at that size; `engineFor(size)` gives the engine
  that renders at a size.
- `manifest.json` holds the regions of the half-size files too (`half`): 343 KB instead of 271 KB before
  compression. Each instance keeps its caches for each of the two sizes.
- Avatar files: build f79cf4b334cd (the 479 layer files at half size in `half/l/` are new; the full-size files are
  the same as in 1.3.0).

## 1.3.0

Faster renders, renders in Web Workers, and parts of an avatar kept apart. No avatar changes: at full size every
selection renders exactly as in 1.2.0, to the pixel (the browser test checks 137 renders: seeds, and every face,
expression, hairstyle, beard, pair of glasses, hat and garment), smaller sizes are scaled down from that same picture,
and every seed keeps its choices (test/identity.txt is unchanged).

- A render fetches and decodes all of its files at once instead of one after another. With 0.3 s per file, a first
  avatar took 3.75 s and now takes 1.14 s (bench/results.md).
- The regions of a layer file are cut out row by row, with 32-bit copies for the colours: 230 ms per avatar before,
  45 ms now.
- `files(selection)` gives the addresses of the files a render fetches, and `preload(selections)` fetches and decodes
  them ahead.
- Web Workers: `createAvatars`, `render`, `toBlob`, `toURL`, `files` and `preload` work in a module worker. There a
  relative `base` is read against the worker's script and `toBlob` encodes with `OffscreenCanvas.convertToBlob`;
  `toCanvas` and `define` say that they need a page. The README covers workers and the cache budgets of several
  instances.
- `render(..., { parts })` keeps parts apart in the same render (`PARTS`: cloth, hair, beard, glasses, hat): how much
  of each pixel the part covers, the picture without it (with the garment: the head without its garment), and its
  tones. For the garment it adds about 90 ms to a render; a second render in another garment colour took 223 ms.
- Types for all of it in index.d.ts. The browser test also checks the pixels against the engine of 1.2.0
  (test/browser/ref/), that `needs()` lists what compose draws, that a render fetches all its files at once, the
  worker, and the parts. bench/ measures fetch, decode, cut and compose.
- Avatar files: build 5110e5e48216 (the engine, the browser entry and the build in the manifest changed; every image
  file is the same).

Not done, and why:

- Composing at the size asked for: a 512 render still composes at 1024 and scales down. Both ways were measured
  (bench/results.md). A second set of files at half size would download 61% less per avatar and decode in 85 ms
  instead of 294 ms, but it changes the build of the files and makes the repository about 56 MB, over the 50 MB that
  jsDelivr serves from a GitHub tag. Scaling the decoded files once costs 67 ms per avatar and needs no new files.
  Either way the engine has to compose at another size, all of its measures in pixels with it; that would save about
  three quarters of composing (about 0.3 s per avatar) and change small pictures slightly. It is left for a later
  version.
- Reading only the regions a render needs from a layer file instead of the whole file: on 79 files it took 968 ms
  against 959 ms (those regions are 90% of a file), so the whole file is read.

## 1.2.0

"Wide smile" and "Laugh" no longer look alike. "Laugh" is now the big open-mouth smile with slightly squinting eyes
that "Wide smile" used to be (its layers are the same files as before, now under "laugh", with blue and green eyes),
and the laugh with the eyes squeezed shut is gone. "Wide smile" is new: a gentler, broad smile that shows the upper
teeth, with the eyes wide open. Every seed keeps its choices (test/identity.txt is unchanged), so an avatar changes
only if its expression is "Wide smile" or "Laugh".

- Avatar files: build a70450e4d3c1 (the 24 layers of "Wide smile" and "Laugh", the two expression maps, the two
  cheek maps and the manifest changed).

## 1.1.0

"Sleepy" no longer looks sad. The image model had drawn it with the mouth turned down and the brows raised at their
inner ends, as in "Sad"; now its mouth and its brows are those of the neutral face, and only the eyelids are heavy and
half closed. Every seed keeps its choices (test/identity.txt is unchanged), so an avatar changes only if its
expression is "Sleepy".

- Avatar files: build eaa4787ca645 (the 12 "Sleepy" layers, the two expression maps and the manifest changed).

## 1.0.1

No avatar changes: every seed gives the same avatar as in 1.0.0.

- On npm: `npm install pixitoons`. The Release workflow now publishes every release to npm as well.
- The tests check that the repository stays under the 50 MB that jsDelivr serves from a GitHub tag (20 MB per file).

## 1.0.0

First release.

- 2 templates (feminine and masculine) with 6 face shapes each, 13 expressions, 4 skin tones, 3 eye colours.
- 16 hairstyles for the feminine template and 15 for the masculine one, and bald, in 4 hair colours; up to 10 beards.
- 3 glasses, 3 kinds of headwear per template, 3 garments in 5 colours, 8 background colours (or any colour, or none).
- Avatar files: build 7990918ff2da.
