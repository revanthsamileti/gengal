"""The liveness probe must stay trivial.

Free hosts idle a service out unless something requests it, so an uptime
monitor hits this URL every few minutes forever. That makes two properties
load-bearing: it answers without a bearer token (a monitor has none), and it
touches nothing external (a monitor must never generate Firestore reads).
"""


def test_healthz_is_public(client):
    """No Authorization header, still 200 -- monitors cannot authenticate."""
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.get_json() == {"status": "ok"}


def test_healthz_does_not_touch_firestore(client, monkeypatch):
    """Make any Firestore access explode, then confirm the probe still passes.

    A probe that reads the database turns a 5-minute monitor into a standing
    quota cost, and starts failing whenever Firestore does -- reporting an
    outage when the process is fine.
    """
    import app as app_module

    def explode(*_a, **_k):
        raise AssertionError("healthz must not touch Firestore")

    monkeypatch.setattr(app_module.firestore, "client", explode)
    assert client.get("/healthz").status_code == 200
