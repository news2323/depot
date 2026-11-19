"""Lokaler Start des Dashboards auf dem Mac:  python3 server.py   (dann http://localhost:8765 öffnen)

Der Server ist nur von diesem Rechner aus erreichbar. Fürs Handy ist der Cloud-Betrieb gedacht (siehe ANLEITUNG.md).
"""
import json
import os
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
DATA = os.path.abspath(args[args.index("--data") + 1]) if "--data" in args else os.path.join(ROOT, "data")
PORT = int(args[args.index("--port") + 1]) if "--port" in args else 8765
FILES = {"portfolio.json", "market.json", "daily.json", "analysis.json", "digest.json", "state.json", "logos.json"}
os.makedirs(DATA, exist_ok=True)


def run(module, *a):
    env = dict(os.environ, DATA_DIR=DATA)
    env.pop("DATA_REPO", None)
    return subprocess.run([sys.executable, "-m", module, *a], cwd=ROOT, env=env, timeout=600).returncode == 0


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.join(ROOT, "web"), **kw)

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _name(self):
        name = urlparse(self.path).path[len("/api/data/"):]
        return name if name in FILES else None

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if not self.path.startswith("/api/data/"):
            return super().do_GET()
        name = self._name()
        path = os.path.join(DATA, name) if name else None
        if not path or not os.path.exists(path):
            return self._json(404, {"error": "nicht vorhanden"})
        with open(path, encoding="utf-8") as f:
            self._json(200, json.load(f))

    def do_PUT(self):
        if self._name() != "portfolio.json":
            return self._json(403, {"error": "nur das Depot ist beschreibbar"})
        try:
            obj = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8"))
            assert isinstance(obj, dict) and isinstance(obj.get("transactions"), list)
        except Exception:
            return self._json(400, {"error": "ungültige Daten"})
        tmp = os.path.join(DATA, "portfolio.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        os.replace(tmp, os.path.join(DATA, "portfolio.json"))
        self._json(200, {"ok": True})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/api/update":
            return self._json(404, {"error": "unbekannt"})
        mode = (parse_qs(u.query).get("mode") or ["fast"])[0]
        ok = run("tracker.update", "all" if mode == "all" else "fast")
        if mode == "all" and (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("XAI_API_KEY")):
            run("tracker.ai")
        ok = run("tracker.digest") and ok
        self._json(200 if ok else 500, {"ok": ok})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print("Dashboard läuft: http://localhost:%d   (Daten: %s)   Beenden mit Ctrl+C" % (PORT, DATA))
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
