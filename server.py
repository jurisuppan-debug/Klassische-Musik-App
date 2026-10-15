"""Startet die App lokal auf http://localhost:8000.

Wie `python3 -m http.server`, sagt dem Browser aber, dass er nichts
zwischenspeichern soll – so sieht man Änderungen immer sofort.
"""
import http.server
import os

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Klassik-App läuft auf http://localhost:{PORT}  (Beenden mit Ctrl + C)")
    http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
