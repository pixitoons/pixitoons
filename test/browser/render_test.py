# Browser test of the package. In Chromium (through Playwright) it renders a fixed list of avatars the way a site uses
# the package and compares them with the images in test/browser/golden/. It also checks the default source of the
# avatar files (the CDN address of this version, answered here from the local files), the check that the files belong
# to this version, the custom element, toBlob, and the demo page on a phone screen and on a desktop screen.
#   python3 test/browser/render_test.py            exit 1 on a difference or an error in a page
#   python3 test/browser/render_test.py --update   write the golden images (after a change of the look that is meant)
# CHROME_PATH: a Chrome to use instead of Playwright's own Chromium. Renders that differ and the screenshots of the
# demo page are written to test/browser/out/.
import asyncio
import base64
import functools
import http.server
import json
import math
import os
import sys
import threading

import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GOLDEN = os.path.join(ROOT, 'test', 'browser', 'golden')
OUT = os.path.join(ROOT, 'test', 'browser', 'out')
UPDATE = '--update' in sys.argv
VERSION = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']
CDN = f'https://cdn.jsdelivr.net/gh/pixitoons/pixitoons@v{VERSION}/assets/'

CASES = [{'name': f'seed{i}', 'seed': f'seed{i}', 'opts': {'size': 256}} for i in range(10)] + [
    {'name': 'dana_transparent', 'seed': 'dana', 'opts': {'size': 256, 'background': 'transparent'}},
    {'name': 'seed3_ginger', 'seed': 'seed3', 'overrides': {'hair_color': 'ginger'}, 'opts': {'size': 256}},
    {'name': 'seed7_512', 'seed': 'seed7', 'opts': {'size': 512}},
]
# Compared with alpha multiplied in, so the colour of fully transparent pixels does not count.
MIN_PSNR, MAX_DIFF = 50.0, 12


class Quiet(http.server.SimpleHTTPRequestHandler):
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
        await ctx.close()

        # 5. The demo page on a phone screen and on a desktop screen.
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
