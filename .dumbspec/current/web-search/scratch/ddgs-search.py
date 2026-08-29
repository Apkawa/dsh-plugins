"""One-shot ddgs text search → JSON on stdout (the shape the plugin consumes).

Usage: uvx --with ddgs python ddgs-search.py --query "..." --backend yandex --max-results 8

The author-disabled yandex engine is activated by injecting its class into the
ENGINES registry (built at import time, but read by DDGS at call time).
Exit code 0 = JSON array on stdout; non-zero = DDGSException message on stderr.
"""

import argparse
import json
import sys
from collections.abc import Sequence

from ddgs import DDGS
from ddgs.engines import ENGINES
from ddgs.engines.yandex import Yandex

ENGINES["text"]["yandex"] = Yandex


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--backend", default="yandex")
    parser.add_argument("--max-results", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=10)
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    try:
        results = DDGS(timeout=args.timeout).text(
            query=args.query,
            backend=args.backend,
            max_results=args.max_results,
        )
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print(json.dumps(results, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
