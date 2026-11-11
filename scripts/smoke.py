"""Small production-container smoke check; no external account or credentials required."""
import json
import re
import sys
from urllib.error import HTTPError
from urllib.request import urlopen

starter = "nextjs"
origin, = sys.argv[1:]


def get(route):
    try:
        response = urlopen(origin.rstrip("/") + route, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers.get("Content-Type", ""), response.read()


status, mime, body = get("/")
assert status == 200 and "text/html" in mime and b"Your web app" in body
asset = re.search(rb'src="([^"?]+\.js(?:\?[^" ]*)?)"', body)
assert asset, "The HTML must reference a production JS asset"
asset_status, asset_mime, _ = get(asset[1].decode())
assert asset_status == 200 and "javascript" in asset_mime
status, mime, body = get("/api/health")
assert status == 200 and "application/json" in mime and json.loads(body)["status"] == "ok"
status, mime, body = get("/api/missing")
assert status == 404
print(f"{starter}: production smoke passed")
