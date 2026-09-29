"""Scratch: run the Yandex engine directly with logging, and fetch the raw page to see what yandex answers."""

import logging
import sys

logging.basicConfig(level=logging.DEBUG, format="%(name)s %(levelname)s %(message)s")

from ddgs.engines.yandex import Yandex

query = sys.argv[1] if len(sys.argv) > 1 else "Последняя версия react"
engine = Yandex(timeout=15)

print("HEADERS:", dict(engine.headers) if hasattr(engine, "headers") else None)

# 1) direct engine.search — see the real per-engine exception
try:
    results = engine.search(query, region="ru-ru", safesearch="moderate", timelimit=None, page=1)
    print("ENGINE SEARCH OK:", len(results), "items")
    for item in results[:3]:
        print(" -", item)
except Exception as error:
    print("ENGINE SEARCH FAILED:", type(error).__name__, error)

# 2) raw page: what does yandex actually send back for the same payload?
payload = engine.build_payload(query, "ru-ru", "moderate", None, page=1)
print("PAYLOAD:", payload)
resp = engine.request("GET", engine.search_url, params=payload)
print("STATUS:", resp.status_code)
body = resp.text
print("LENGTH:", len(body))
print("BODY HEAD:", body[:2000])
