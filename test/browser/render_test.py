# Browser test of the package. In Chromium (through Playwright) it renders a fixed list of avatars the way a site uses
# the package and compares them with the images in test/browser/golden/. It also checks the default source of the
# avatar files (the CDN address of this version, answered here from the local files), the check that the files belong
# to this version, the custom element, toBlob, and the demo page on a phone screen and on a desktop screen.
# And what keeps renders fast, for every change after it as well:
#   - same pixels: at full size every selection renders exactly as with the engine in test/browser/ref/, the engine
#     of the last release whose look this one keeps, over seeds and every face, expression, hairstyle, beard, pair
#     of glasses, hat and garment. A change for speed must pass it unchanged;
#   - small sizes: renders at 512 and 256 from the half-size files stay close to that engine's (composed at 1024 and
#     scaled down): a bound on the difference, measured once its frame is aligned (SMALL_PSNR, SMALL_P999);
#   - the file list: what compose() asks for is what needs() lists, at both sizes (compose fetches that list all at
#     once, so a part that needs() leaves out would load one file after another again), and one render fetches all
#     its files at once;
#   - a Web Worker: the package renders there as on the page, toBlob works, toCanvas and define() say they need a page;
#   - parts: render(..., { parts }) keeps the picture as it is, and cover, without and tones agree with it.
#   python3 test/browser/render_test.py               exit 1 on a difference or an error in a page
#   python3 test/browser/render_test.py --update      write the golden images (after a change of the look that is meant)
#   python3 test/browser/render_test.py --update-ref  copy src/engine.js and src/avatars.js to test/browser/ref/ (after
#                                                     a change of the look that is meant, released as such)
# CHROME_PATH: a Chrome to use instead of Playwright's own Chromium. Renders that differ and the screenshots of the
# demo page are written to test/browser/out/.
import asyncio
import base64
import functools
import http.server
import json
import math
import os
import shutil
import sys
import threading

import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GOLDEN = os.path.join(ROOT, 'test', 'browser', 'golden')
OUT = os.path.join(ROOT, 'test', 'browser', 'out')
UPDATE = '--update' in sys.argv
UPDATE_REF = '--update-ref' in sys.argv
REF = os.path.join(ROOT, 'test', 'browser', 'ref')
VERSION = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']
CDN = f'https://cdn.jsdelivr.net/npm/pixitoons@{VERSION}/assets/'

CASES = [{'name': f'seed{i}', 'seed': f'seed{i}', 'opts': {'size': 256}} for i in range(10)] + [
    {'name': 'dana_transparent', 'seed': 'dana', 'opts': {'size': 256, 'background': 'transparent'}},
    {'name': 'seed3_ginger', 'seed': 'seed3', 'overrides': {'hair_color': 'ginger'}, 'opts': {'size': 256}},
    {'name': 'seed7_512', 'seed': 'seed7', 'opts': {'size': 512}},
]
# Compared with alpha multiplied in, so the colour of fully transparent pixels does not count.
MIN_PSNR, MAX_DIFF = 50.0, 12
# Small renders from the half-size files against the reference engine's (see smallVsRef in page.html), for every
# selection of section 5 once the frames are aligned: the least PSNR, and the most the 99.9th percentile of a pixel's
# largest difference may be (1.4.0 against 1.3.0 at 512: 33.4 dB and 83 at worst, 38.7 dB on average).
SMALL_PSNR, SMALL_P999 = 32.0, 128


class Quiet(http.server.SimpleHTTPRequestHandler):
    # test/browser/w/files/ is answered from assets/: the base of the worker test (see w/worker.js)
    ALIAS = '/test/browser/w/files/'

    def translate_path(self, path):
        p = path.split('?', 1)[0].split('#', 1)[0]
        if p.startswith(self.ALIAS):
            path = '/assets/' + p[len(self.ALIAS):]
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'


def watch(page, errors):
    # A failed request is reported by the response watcher below, with its address; a missing favicon is not the
    # page's own.
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}')
            if m.type in ('error', 'warning') and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('response', lambda r: errors.append(f'{r.status} {r.url}')
            if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)


def rgba(res):
    return np.frombuffer(base64.b64decode(res['b64']), np.uint8).reshape(res['h'], res['w'], 4)


def premultiplied(a):
    f = a.astype(np.float64)
    return np.concatenate([f[..., :3] * f[..., 3:4] / 255.0, f[..., 3:4]], axis=-1)


def compare(name, img):
    """None when the render matches its golden image (or the golden image was written), else the problem."""
    path = os.path.join(GOLDEN, f'{name}.png')
    if UPDATE:
        Image.fromarray(img, 'RGBA').save(path, optimize=True)
        return None
    if not os.path.exists(path):
        return 'no golden image; run with --update'
    gold = np.asarray(Image.open(path).convert('RGBA'))
    if gold.shape != img.shape:
        return f'size {img.shape[1]}x{img.shape[0]}, golden {gold.shape[1]}x{gold.shape[0]}'
    d = np.abs(premultiplied(img) - premultiplied(gold))
    mse = float((d ** 2).mean())
    psnr = math.inf if mse == 0 else 10 * math.log10(255 ** 2 / mse)
    print(f'  {name}: PSNR {psnr:.1f} dB, largest difference {d.max():.0f}')
    if psnr < MIN_PSNR or d.max() > MAX_DIFF:
        Image.fromarray(img, 'RGBA').save(os.path.join(OUT, f'{name}.png'))
        return f'differs from the golden image (PSNR {psnr:.1f} dB, largest difference {d.max():.0f}); see test/browser/out/'
    return None


async def main():
    os.makedirs(GOLDEN, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    if UPDATE_REF:
        for f in ('engine.js', 'avatars.js'):
            shutil.copyfile(os.path.join(ROOT, 'src', f), os.path.join(REF, f))
        with open(os.path.join(REF, 'VERSION'), 'w', encoding='utf-8') as fh:
            fh.write(VERSION + '\n')
        print(f'test/browser/ref/ now holds the engine of {VERSION}')
    ref_version = open(os.path.join(REF, 'VERSION'), encoding='utf-8').read().strip()
    srv, url = serve()
    problems, errors = [], []
    async with async_playwright() as p:
        kw = {'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}
        browser = await p.chromium.launch(headless=True, **kw)
        ctx = await browser.new_context(viewport={'width': 800, 'height': 600})
        page = await ctx.new_page()
        watch(page, errors)
        await page.goto(f'{url}/test/browser/page.html')
        await page.wait_for_function('window.ready === true')

        # 1. The avatars, from the files of this repository.
        print('renders' + (' (writing the golden images)' if UPDATE else ''))
        res = await page.evaluate('([base, cases]) => renderCases(base, cases)', ['../../assets/', CASES])
        for c in CASES:
            problem = compare(c['name'], rgba(res[c['name']]))
            if problem:
                problems.append(f"{c['name']}: {problem}")

        # 2. With no base the files come from the CDN address of this version (answered here from assets/).
        hits = []

        async def cdn(route):
            rel = route.request.url[len(CDN):].split('?')[0]
            hits.append(rel)
            path = os.path.join(ROOT, 'assets', *rel.split('/'))
            if os.path.isfile(path):
                await route.fulfill(path=path, headers={'Access-Control-Allow-Origin': '*'})
            else:
                await route.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'})
        await ctx.route(CDN + '**', cdn)
        res2 = await page.evaluate('([base, cases]) => renderCases(base, cases)', [None, CASES[:1]])
        if 'manifest.json' not in hits:
            problems.append(f'default source: nothing was asked from {CDN}')
        elif not np.array_equal(rgba(res2['seed0']), rgba(res['seed0'])):
            problems.append('default source: seed0 from the CDN address differs from seed0 from assets/')
        print(f'default source: {len(hits)} files asked from {CDN}')

        # 3. Files of another build are refused with a clear message.
        man = json.load(open(os.path.join(ROOT, 'assets', 'manifest.json'), encoding='utf-8'))
        man['build'] = 'another-build'
        await ctx.route(f'{url}/other/manifest.json', lambda route: route.fulfill(
            body=json.dumps(man), content_type='application/json'))
        msg = await page.evaluate("() => lib.createAvatars({ base: '/other/' }).then(() => 'loaded', (e) => e.message)")
        if 'needs build' not in msg:
            problems.append(f'build check: expected a refusal, got "{msg}"')
        print(f'build check: {msg[:90]}')

        # 4. The custom element and toBlob.
        info = await page.evaluate('''async () => {
          const a = await lib.createAvatars({ base: '../../assets/' });
          a.define();
          const el = document.createElement('pixitoons-avatar');
          el.setAttribute('seed', 'seed1');
          el.setAttribute('size', '64');
          el.setAttribute('alt', 'Seed one');
          document.body.append(el);
          for (let i = 0; i < 400 && !el.querySelector('canvas'); i++) await new Promise((r) => setTimeout(r, 50));
          const c = el.querySelector('canvas');
          const blob = await a.toBlob('seed1', { size: 64 });
          return { canvas: c && [c.width, c.height, c.getAttribute('aria-label')], blob: [blob.type, blob.size] };
        }''')
        if info['canvas'] != [64, 64, 'Seed one']:
            problems.append(f"custom element: {info['canvas']}")
        if info['blob'][0] != 'image/png' or info['blob'][1] < 1000:
            problems.append(f"toBlob: {info['blob']}")
        print(f"custom element: {info['canvas']}; toBlob: {info['blob']}")

        # 5. Same pixels at full size as the engine in ref/ (on the seed's background and on none for the seeds).
        base = '../../assets/'
        sels = await page.evaluate('([base, n]) => selections(base, n)', [base, 16])
        cases = [dict(c, bgs=[None, 'transparent']) if c['seed'].startswith('seed') else c for c in sels]
        same = await page.evaluate('([base, list]) => sameAsRef(base, list)', [base, cases])
        bad = [f"{r['seed']} ({r['bg']})" for r in same if not r['same']]
        if bad:
            problems.append(f'same pixels as {ref_version}: {len(bad)} of {len(same)} renders differ: {", ".join(bad[:8])}')
        print(f'same pixels as {ref_version} at full size: {len(same) - len(bad)} of {len(same)} renders')

        # 5b. Small sizes from the half-size files, against the reference engine (composed at 1024, scaled down).
        for size in (512, 256):
            small = await page.evaluate('([base, list, size]) => smallVsRef(base, list, size)', [base, sels, size])
            worst = min(small, key=lambda r: r['psnrAligned'])
            bad = [r for r in small if r['psnrAligned'] < SMALL_PSNR or r['p999Aligned'] > SMALL_P999]
            for r in bad[:5]:
                problems.append(f"small at {size}, {r['seed']}: PSNR {r['psnrAligned']:.1f} dB, 99.9th percentile "
                                f"{r['p999Aligned']:.0f} (aligned)")
            mean = sum(r['psnrAligned'] for r in small) / len(small)
            raw = sum(r['psnr'] for r in small) / len(small)
            print(f"small at {size} against {ref_version}: PSNR mean {mean:.1f} dB, least {worst['psnrAligned']:.1f} dB "
                  f"({worst['seed']}), 99.9th percentile at most {max(r['p999Aligned'] for r in small):.0f}; "
                  f"without aligning the frame ({small[0]['shift']} row) {raw:.1f} dB")

        # 6. needs() lists what compose() asks for (full and half size), and one render fetches all its files at once.
        for size in (None, 512):
            diff = await page.evaluate('([base, list, size]) => contract(base, list, size)', [base, sels, size])
            for d in diff[:5]:
                problems.append(f"needs() at size {size} for {d['seed']}: asked but not listed {d['missing']}, "
                                f"listed but not asked {d['extra']}")
            print(f"needs() against compose() at size {size or 1024}: {len(sels) - len(diff)} of {len(sels)} selections agree")
        for size in (1024, 256):
            once = await page.evaluate('([base, seed, size]) => fetchAtOnce(base, seed, size)', [base, 'seed3', size])
            if sorted(once['fetched']) != sorted(once['files']):
                problems.append(f"files() at {size}: lists {len(once['files'])} files, the render fetched {len(once['fetched'])}")
            if once['peak'] < len(once['files']):
                problems.append(f"fetching at {size}: at most {once['peak']} of {len(once['files'])} files were asked "
                                'for at the same time')
            print(f"one render at {size}: {len(once['fetched'])} files, {once['peak']} asked for at the same time")

        # 7. In a module Web Worker: the same pixels as on the page, base read against the worker's script.
        w = await page.evaluate("(msg) => inWorker(msg)", {'base': 'files/', 'seed': 'dana', 'size': 256})
        if w.get('error'):
            problems.append(f"worker: {w['error']}")
        else:
            if not np.array_equal(rgba(w['img']), rgba(res['dana_transparent'])):
                problems.append('worker: dana differs from the render on the page')
            if w['blob'][0] != 'image/png' or w['blob'][1] < 1000:
                problems.append(f"worker: toBlob gave {w['blob']}")
            if not all(f.startswith(f'{url}/test/browser/w/files/') for f in w['files']):
                problems.append(f"worker: files() is not read against the worker's script: {w['files'][:2]}")
            for k in ('canvas', 'define'):
                if 'needs a page' not in w[k]:
                    problems.append(f'worker: {k} gave "{w[k]}"')
        print(f"worker: {'error' if w.get('error') else 'renders, toBlob ' + str(w['blob'])}; "
              f"toCanvas: {w.get('canvas')}; define: {w.get('define')}")

        # 8. Parts: the picture stays the same, and cover, without and tones agree with it (at 512, as a host asks).
        for seed in ('seed0', 'seed1', 'seed5', 'seed9', 'dana'):
            pc = await page.evaluate('([base, seed, size, names]) => partsCheck(base, seed, size, names)',
                                     [base, seed, 512, ['cloth', 'hair', 'beard', 'glasses', 'hat']])
            sel = pc['sel']
            if not pc['same']:
                problems.append(f'parts, {seed}: the picture differs from the render without parts')
            for name, r in pc['parts'].items():
                where = f"parts, {seed} {name} ({sel[name]})"
                # what of the part shows: a garment always; a beard, glasses or a hat unless "none" (stubble is
                # only a shade of the skin); hair unless a hat hides it, so it is not foretold
                shows = {'cloth': True, 'beard': sel['beard'] != 'none' and not sel['beard'].startswith('stubble'),
                         'glasses': sel['glasses'] != 'none', 'hat': sel['hat'] != 'none'}.get(name, r['coverSum'] > 0)
                if shows != (r['coverSum'] > 0) or shows != (r['tones'] is not None):
                    problems.append(f"{where}: cover sum {r['coverSum']}, tones {r['tones']}")
                if (sel[name] == 'none') != (r['differ'] == 0):
                    problems.append(f"{where}: without differs from the picture at {r['differ']} pixels")
                if r['size'] != [512, 512 * 512]:
                    problems.append(f"{where}: sizes {r['size']}")
                if r['darkerOutside'] > 0:
                    problems.append(f"{where}: without is darker than the picture at {r['darkerOutside']} pixels "
                                    'the part does not cover')
                if r['coveredLeft'] > 2:
                    problems.append(f"{where}: alpha {r['coveredLeft']} left where the part covers all")
            cl = pc['parts']['cloth']
            if cl['changedOutside'] > 0:
                problems.append(f"parts, {seed}: {cl['changedOutside']} of the {cl['changed']} pixels that another "
                                'garment colour changes are outside the cover of the garment')
            print(f"parts, {seed}: picture {'same' if pc['same'] else 'DIFFERS'}; garment {cl['tones']}, "
                  f"{cl['changed']} pixels change with another colour, {cl['changedOutside']} outside its cover")
        await ctx.close()

        # 9. The demo page on a phone screen and on a desktop screen.
        views = [('phone', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True,
                                has_touch=True)),
                 ('desktop', dict(viewport={'width': 1280, 'height': 900}))]
        ready = ("document.getElementById('status').textContent.startsWith('Ready') && "
                 "document.querySelectorAll('pixitoons-avatar canvas').length === 12")
        for label, view in views:
            c2 = await browser.new_context(**view)
            pg = await c2.new_page()
            watch(pg, errors)
            await pg.goto(f'{url}/demo/index.html')
            await pg.wait_for_function(ready, timeout=120000)
            await pg.click('button[data-seed="kofi"]')
            await pg.wait_for_function(
                "document.querySelector('button[data-seed=\"kofi\"]').getAttribute('aria-pressed') === 'true' && "
                + ready, timeout=60000)
            wide = await pg.evaluate('document.documentElement.scrollWidth - window.innerWidth')
            if wide > 0:
                problems.append(f'demo on the {label} screen is {wide}px wider than the screen')
            await pg.screenshot(path=os.path.join(OUT, f'demo_{label}.png'), full_page=True)
            print(f'demo, {label}: ready; overflow {wide}px')
            await c2.close()
        await browser.close()
    srv.shutdown()

    problems += [f'page: {e}' for e in errors]
    if problems:
        print('\nFAILED')
        for p in problems:
            print(f'  {p}')
        sys.exit(1)
    print('\nall browser checks passed')


asyncio.run(main())
