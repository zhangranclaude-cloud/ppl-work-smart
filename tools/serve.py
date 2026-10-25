"""Local dev server for Ppl Work Smart.

Same as `python -m http.server`, but tells the browser not to cache, so an
edited script is always picked up on reload instead of an old cached copy.
Listens on 127.0.0.1 only.

    python tools/serve.py [port]
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving Ppl Work Smart at http://127.0.0.1:{port}/ (no-cache). Ctrl+C to stop.")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
