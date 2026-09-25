# Serves src/ for trying the app in a browser, with caching off so edits show
# up on reload. Also stands in for the desktop app's timetable download:
# /__gtfs.zip and /__gtfs.etag (AT's gtfs.zip has no CORS headers).
#   python tools/dev_server.py [port]
import functools, http.server, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src")
CACHE = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(HERE, ".."), "akl-live-dev")   # not in OneDrive
GTFS = "https://gtfs.at.govt.nz/gtfs.zip"


def gtfs():
    """(etag, bytes) for AT's gtfs.zip, re-downloaded at most twice a day."""
    os.makedirs(CACHE, exist_ok=True)
    zp, ep = os.path.join(CACHE, "gtfs.zip"), os.path.join(CACHE, "gtfs.etag")
    if not os.path.exists(zp) or time.time() - os.path.getmtime(zp) > 12 * 3600:
        with urllib.request.urlopen(GTFS, timeout=120) as r:
            data = r.read()
            etag = (r.headers.get("ETag") or str(len(data))).strip('"')
        open(zp, "wb").write(data)
        open(ep, "w").write(etag)
    return open(ep).read().strip(), open(zp, "rb").read()


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/__gtfs."):
            etag, data = gtfs()
            body = etag.encode() if self.path.startswith("/__gtfs.etag") else data
            self.send_response(200)
            self.send_header("Content-Type", "text/plain" if body is not data else "application/zip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(Handler, directory=SRC)
    print(f"AKL Live preview on http://127.0.0.1:{port}/", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
