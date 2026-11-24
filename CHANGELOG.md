# Changelog

Every release is a git tag (vX.Y.Z) with a GitHub release that cannot change after it is published. What each
number means is in README.md ("Versions").

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
