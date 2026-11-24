# Changelog

Every release is a git tag (vX.Y.Z) with a GitHub release that cannot change after it is published. What each
number means is in README.md ("Versions").

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
