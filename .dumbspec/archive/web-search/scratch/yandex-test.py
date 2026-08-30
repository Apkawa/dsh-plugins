"""Scratch: enable the author-disabled yandex engine and run a text search.

ddgs 9.x builds its ENGINES registry at import time and skips engines with
`disabled = True`. `DDGS._get_engines` reads the ENGINES dict at call time, so
injecting the Yandex class after import is enough to activate it.
"""

import json
import sys

from ddgs import DDGS
from ddgs.engines import ENGINES
from ddgs.engines.yandex import Yandex

ENGINES["text"]["yandex"] = Yandex

query = sys.argv[1] if len(sys.argv) > 1 else "Последняя версия react"
ddgs = DDGS(timeout=15)
try:
    results = ddgs.text(query=query, backend="yandex", max_results=5)
except Exception as error:
    print(f"ERROR: {type(error).__name__}: {error}", file=sys.stderr)
    raise
print(json.dumps(results, ensure_ascii=False, indent=2))
