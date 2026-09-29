"""Scratch: probe yandex rate-limit characteristics — spaced single requests, raw page on failure."""

import json
import sys
import time

from ddgs import DDGS
from ddgs.engines import ENGINES
from ddgs.engines.yandex import Yandex

ENGINES["text"]["yandex"] = Yandex

queries = [
    "Последняя версия react",
    "node.js lts version",
    "latest react version",
]

for i, query in enumerate(queries):
    if i > 0:
        time.sleep(6)
    start = time.monotonic()
    try:
        results = DDGS(timeout=10).text(query=query, backend="yandex", max_results=3)
        print(f"[{i}] OK in {time.monotonic() - start:.1f}s: {len(results)} items | {results[0]['title'] if results else '-'}")
    except Exception as error:
        print(f"[{i}] FAIL in {time.monotonic() - start:.1f}s: {error}")
        # what does the raw page look like on failure?
        engine = Yandex(timeout=10)
        payload = engine.build_payload(query, "ru-ru", "moderate", None, page=1)
        html = engine.request("GET", engine.search_url, params=payload)
        print(f"    raw page: {len(html)} chars; CAPTCHA-ish: {'captcha' in html.lower() or 'smartcaptcha' in html.lower()}")
        print("    HEAD:", html[:600].replace("\n", " "))
