# Benchmark results

Measured with `bench/run.py` in Chromium (Playwright, headless) on a 2-core cloud container, with 0.3 s added to every
avatar file as if it came over the network. Each seed is rendered cold first (a new browser context, so nothing is
cached), then the cutting, the composing and the renders again on that engine. Times are the mean over seed0 to
seed11, with the lowest and highest in brackets, at size 512 on a transparent background. Add the numbers of every
change made for speed here, measured before and after on the same machine:

```sh
python3 bench/run.py --lib ../test/browser/ref/avatars.js --label before   # the engine of the last release
python3 bench/run.py --label after                                          # this one
```

## 1.4.0 (2026-11-24)

At 512 px a render now loads the half-size files (`half/l/`) and composes at 512. The same conditions as below,
except that the delay now applies to the half-size files too (`/assets/half/l/`); 1.3.0 measured again with them:

| | 1.3.0 | 1.4.0: the half-size files |
|---|---:|---:|
| first avatar (cold) | 1146 (909 to 1286) | 848 (755 to 1045) |
| files fetched, most at the same time | 8.6 (7 to 12) | 8.6 (7 to 12) |
| fetching, from the first request to the last answer | 821 (664 to 918) | 678 (621 to 764) |
| fetching, the times of the files added up | 3997 (2582 to 5799) | 3682 (2543 to 6151) |
| decoding, the times of the calls added up | 741 (414 to 1466) | 301 (133 to 563) |
| cutting the regions out of the files | 43 (36 to 54) | 11 (7 to 16) |
| composing (files decoded, colours made again) | 411 (292 to 597) | 144 (86 to 233) |
| render at 512 (files decoded) | 447 (340 to 638) | 112 (60 to 174) |
| render again (everything cached) | 202 (136 to 254) | 59 (28 to 96) |
| bytes fetched, the manifest included (KB) | 900 | 589 |

The bytes include `manifest.json`, which holds the regions of the half-size files too (343 KB instead of 271 KB);
without it an avatar's files were 629 KB and are now 246 KB. Composing at 512 does a quarter of the pixel work, as
the measurement for 1.3.0 below estimated.

Parts at 512 px, the same 12 seeds with their files decoded and the colours made again: a render 124 ms, with the
garment kept apart 143 ms (19 ms more), the same avatar in another garment colour 70 ms.

The avatars at 512 px against 1.3.0's (composed at 1024 and scaled down), over the 137 renders of the browser test:
PSNR 38.7 dB on average once the frames are aligned (the half-size frame is shifted by 25 px, which is 50 px at 1024,
not 49), 33.4 dB at the least (fine braids), and 33.4 dB on average as they are; the 99.9th percentile of a pixel's
largest difference is 83 at most. At 256 px: 42.0 dB on average, 37.0 dB at the least.

## 1.3.0 (2026-11-24)

"Item 1" is the engine of 1.3.0 with the cutting of 1.2.0, so each change shows on its own.

| | 1.2.0 | item 1: files at once | 1.3.0: and row-wise cutting |
|---|---:|---:|---:|
| first avatar (cold) | 3751 (2885 to 5088) | 1372 (1154 to 1718) | 1139 (839 to 1332) |
| files fetched at the same time, most | 1 | 8.6 (7 to 12) | 8.6 (7 to 12) |
| fetching, from the first request to the last answer | 3506 (2647 to 4940) | 794 (631 to 1151) | 811 (663 to 1051) |
| fetching, the times of the files added up | 2689 (2148 to 3762) | 4105 (2780 to 6070) | 4028 (2620 to 6315) |
| decoding, the times of the calls added up | 297 (184 to 386) | 964 (450 to 1505) | 682 (441 to 1120) |
| cutting the regions out of the files | 230 (93 to 318) | 252 (125 to 412) | 45 (29 to 62) |
| composing (files decoded, colours made again) | 452 (278 to 655) | 455 (351 to 674) | 405 (223 to 554) |
| render at 512 (files decoded) | 392 (285 to 496) | 439 (318 to 542) | 417 (312 to 573) |
| render again (everything cached) | 226 (124 to 314) | 212 (115 to 360) | 215 (121 to 302) |

All times in ms. When the files of an avatar are fetched and decoded side by side, each one waits longer (the sums
grow), but the avatar waits for the slowest one only.

**Parts (`render(..., { parts: ['cloth'] })`)**, the same 12 seeds with their files decoded and the colours made
again: 1.2.0 needed a second render in another garment colour, 223 ms after a render of 409 ms (and the pixels compared
by the host). 1.3.0: 430 ms without parts and 520 ms with the garment kept apart, so 90 ms for its cover, the head
without it and its tones. Inside compose the garment costs 65 ms; a part the avatar does not have costs nothing.

**Cache budgets** (for several instances, such as one per Web Worker): one instance fills its default budgets (192 MB
of decoded files, 128 MB of recoloured layers) after about 8 avatars. 32 avatars in a row, files from this machine:
518 ms per avatar with the defaults, 544 ms with `imageBytes` 64 MB and `colorBytes` 32 MB, 560 ms with 32 MB and
16 MB.

**Reading only the regions** a render needs from a layer file, instead of the whole file with one getImageData: 79
files of the 12 avatars, each read both ways on a new canvas, 968 ms against 959 ms (the regions are 90% of a file).
Not worth it, so the whole file is read.

**Composing at the size asked for (not done; measured for the decision).** The layer files of an avatar (6.6 per
avatar here, the colour maps aside):

| | files as they are | a second set at half size |
|---|---:|---:|
| all 479 layer files | 38.7 MB | 14.7 MB (38%) |
| per avatar | 491 KB | 190 KB |
| decoding per avatar (one file after another) | 294 ms | 85 ms |

The half-size files were made from the published ones, encoded as pipeline/sprites.py encodes (WebP quality 95 for
hair, beard and clothing, 90 for the rest, alpha at 100). With them the repository would hold about 56 MB, over the 50
MB that jsDelivr serves from a GitHub tag. The other way, scaling each decoded file once to half size in JavaScript,
costs 67 ms per avatar. Either way composing then runs at 512: of 413 ms at 1024, layerColor took 153 ms, drawMapped
74, shadowMapped 60, hairBehind 26, rimLit 26 and draw 20, all of it work per pixel, so about a quarter of it would
remain (an estimate: it needs the engine to work at another size).
