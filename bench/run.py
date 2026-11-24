# Benchmark of the library as a host uses it: python3 bench/run.py [--seeds 12] [--latency 0.3] [--size 512]
#   [--lib ../test/browser/ref/avatars.js] [--label name] [--json out.json]
# It serves this repository with a delay on every avatar file (--latency seconds, like files over the network), and
# renders N seeds in Chrome through bench/page.html: each one cold (a new engine in a new browser context, with empty
# caches), then the cutting, the composing and a warm render on that engine. It prints the times split into fetch,
# decode, cut and compose, and with --json writes them for the record in bench/results.md. --lib measures another
# copy of the library (a path from bench/; default ../src/avatars.js): ../test/browser/ref/avatars.js is the engine
# of the last release, so one command gives the numbers before and after a change.
# CHROME_PATH: a Chrome to use instead of Playwright's own Chromium.
import argparse
import asyncio
import functools
import http.server
import json
import os
import statistics
import threading
import time

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--seeds', type=int, default=12)
ap.add_argument('--latency', type=float, default=0.3)
ap.add_argument('--size', type=int, default=512)
ap.add_argument('--lib', default='')
ap.add_argument('--label', default='')
ap.add_argument('--json', default='')
args = ap.parse_args()


class Slow(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def do_GET(self):
        # every avatar file (both sizes of layer files, and the colour maps); not the manifest
        if any(d in self.path for d in ('/assets/l/', '/assets/half/l/', '/assets/lut/')):
            time.sleep(args.latency)
        super().do_GET()


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Slow, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'


def summary(rows, key):
    v = [r[key] for r in rows]
    return {'mean': statistics.mean(v), 'min': min(v), 'max': max(v)}


async def main():
    srv, url = serve()
    async with async_playwright() as p:
        kw = {'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}
        browser = await p.chromium.launch(headless=True, **kw)
        rows = []
        for i in range(args.seeds):
            # a new browser context for every seed: its caches start empty, as on a first visit
            ctx = await browser.new_context()
            page = await ctx.new_page()
            await page.goto(f'{url}/bench/page.html' + (f'?lib={args.lib}' if args.lib else ''))
            await page.wait_for_function('window.ready === true')
            c = await page.evaluate('([b, s, o]) => cold(b, s, o)',
                                    ['../assets/', f'seed{i}', {'size': args.size, 'background': 'transparent'}])
            w = await page.evaluate('() => warm()')
            rows.append({**c, **{f'warm_{k}': v for k, v in w.items()}})
            await ctx.close()
        await browser.close()
    srv.shutdown()
    keys = ['total', 'files', 'fetchSum', 'fetchSpan', 'peak', 'decode', 'warm_cut', 'warm_compose', 'warm_render',
            'warm_hot']
    res = {'label': args.label, 'lib': args.lib or '../src/avatars.js', 'seeds': args.seeds, 'latency': args.latency,
           'size': args.size,
           'summary': {k: summary(rows, k) for k in keys}, 'rows': rows}
    names = {'total': 'cold avatar, wall', 'files': 'layer files', 'fetchSum': 'fetch, sum of files',
             'fetchSpan': 'fetch, wall span', 'peak': 'requests in flight, most', 'decode': 'decode',
             'warm_cut': 'cut', 'warm_compose': 'compose (files decoded, colours made again)',
             'warm_render': f'render at {args.size} (files decoded)', 'warm_hot': 'render again (all cached)'}
    print(f'{args.label or "run"}: {args.seeds} seeds, latency {args.latency}s per file, size {args.size}')
    for k in keys:
        s = res['summary'][k]
        unit = '' if k in ('files', 'peak') else ' ms'
        print(f"  {names[k]:44s} {s['mean']:8.1f}{unit}   ({s['min']:.0f} to {s['max']:.0f})")
    if args.json:
        with open(args.json, 'w') as f:
            json.dump(res, f, indent=1)


asyncio.run(main())
