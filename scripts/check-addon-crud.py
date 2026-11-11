"""Run create, restart the app yourself, then run verify with the printed id.
Usage: python3 scripts/check-addon-crud.py ORIGIN [persisted-id]
Targets only an explicitly selected disposable test app; deletes only its own row.
"""
import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

origin, *saved = sys.argv[1:]
def call(path, method="GET", data=None):
    request = Request(origin.rstrip("/") + path, method=method,
                      data=json.dumps(data).encode() if data is not None else None,
                      headers={"Content-Type": "application/json"})
    try:
        response = urlopen(request, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        return response.status, json.loads(body) if body else None

if saved:
    identity = saved[0]
    assert any(item["id"] == identity and item["done"] for item in call("/api/todos")[1])
    path = "/api/todos?id=" + identity
    assert call(path, "DELETE")[0] == 204
    print("Persistence after restart and deletion passed")
else:
    status, todo = call("/api/todos", "POST", {"title": "Starter persistence check"})
    assert status == 201, (status, todo)
    identity = todo["id"]
    path = "/api/todos"
    patch = {"id": identity, "done": True}
    assert call(path, "PATCH", patch)[1]["done"] is True
    assert call("/api/todos", "POST", {"title": ""})[0] in {400, 422}
    print("Restart the app, then run verify with id:", identity)
