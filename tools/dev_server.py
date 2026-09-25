# Serves src/ for trying the app in a browser, with caching off so edits show
# up on reload.   python tools/dev_server.py [port]
import functools, http.server, os, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCache, directory=SRC)
    print(f"AKL Live preview on http://127.0.0.1:{port}/", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
