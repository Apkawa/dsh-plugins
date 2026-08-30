#!/usr/bin/env python3
"""One-shot ddgs text search: JSON array on stdout (exit 0) or a one-line error (exit 1).

Run under the plugin's managed uv venv:
  <venv>/bin/python ddgs-search.py --query <q> --backend <b> --max-results <n> --timeout <s>
"""

import argparse
import json
import sys


def search(query, backend, max_results, timeout):
    from ddgs import DDGS
    # The yandex engine exists upstream but ships disabled (disabled = True);
    # re-register it so `--backend yandex` keeps working.
    if backend == 'yandex':
        from ddgs.engines import ENGINES
        from ddgs.engines.yandex import Yandex
        ENGINES['text']['yandex'] = Yandex
    return DDGS(timeout=timeout).text(query=query, backend=backend, max_results=max_results)


def main():
    parser = argparse.ArgumentParser(description='ddgs one-shot text search')
    parser.add_argument('--query', required=True)
    parser.add_argument('--backend', default='duckduckgo')
    parser.add_argument('--max-results', type=int, default=8)
    parser.add_argument('--timeout', type=float, default=10.0)
    args = parser.parse_args()
    try:
        results = search(args.query, args.backend, args.max_results, args.timeout)
    except BaseException as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        return 1
    print(json.dumps(results, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
