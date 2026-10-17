"""Reports in the admin panel, and bans: what a ban stops, and that only an
admin can do it."""
from datetime import datetime, timedelta, timezone

import pytest

import app as app_module
from fake_firestore import FakeFirestoreModule


ADMIN = "admin_uid"
BAD = "bad_actor"
NICE = "nice_user"


@pytest.fixture
def store(monkeypatch):
    now = datetime.now(timezone.utc)
    data = {
        "users/%s" % BAD: {"nickname": "Troll", "isOnline": True, "isActiveMode": True, "coins": 50},
        "users/%s" % NICE: {"nickname": "Asha", "coins": 50},
        "users/r1": {"nickname": "Ravi"},
        "users/r2": {"nickname": "Kiran"},
        "reports/a": {"reporterUid": "r1", "targetUid": BAD, "reason": "Harassment or abuse",
                      "source": "profile", "status": "open", "createdAt": now - timedelta(hours=2)},
        "reports/b": {"reporterUid": "r2", "targetUid": BAD, "reason": "Harassment or abuse",
                      "source": "chat", "status": "open", "createdAt": now - timedelta(hours=1)},
        "reports/c": {"reporterUid": "r1", "targetUid": NICE, "reason": "Fake profile",
                      "source": "profile", "status": "open", "createdAt": now},
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    monkeypatch.setitem(app_module.BANNED_CACHE, "at", 0.0)
    return data


@pytest.fixture
def firebase_auth(monkeypatch):
    calls = []
    monkeypatch.setattr(app_module.auth, "update_user", lambda uid, **kw: calls.append(("update", uid, kw)))
    monkeypatch.setattr(app_module.auth, "revoke_refresh_tokens", lambda uid: calls.append(("revoke", uid)))
    return calls


@pytest.fixture
def admin(client, monkeypatch):
    monkeypatch.setattr(app_module, "require_admin_uid", lambda: (ADMIN, None))

    def post(path, **body):
        return client.post("/api/v1/admin/" + path, json=body)
    return post


class TestReportsList:
    def test_grouped_by_person_most_reported_first(self, admin, store):
        body = admin("reports").get_json()

        assert [g["targetUid"] for g in body["groups"]] == [BAD, NICE]
        troll = body["groups"][0]
        assert troll["nickname"] == "Troll"
        assert troll["count"] == 2
        assert troll["reasons"] == {"Harassment or abuse": 2}
        assert [r["reporter"] for r in troll["reports"]] == ["Kiran", "Ravi"]   # newest first

    def test_dismissing_closes_that_persons_reports_only(self, admin, store):
        admin("reports", action="dismiss", targetUid=NICE)

        assert store["reports/c"]["status"] == "resolved"
        assert store["reports/c"]["resolution"] == "dismissed"
        assert store["reports/a"]["status"] == "open"
        assert [g["targetUid"] for g in admin("reports").get_json()["groups"]] == [BAD]

    def test_admins_only(self, client, store, monkeypatch):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (None, ({"error": "no"}, 403)))

        assert client.post("/api/v1/admin/reports", json={}).status_code == 403
        assert client.post("/api/v1/admin/ban", json={"uid": BAD}).status_code == 403


class TestBan:
    def test_ban_disables_sign_in_and_closes_reports(self, admin, store, firebase_auth):
        response = admin("ban", uid=BAD, reason="Harassment")

        assert response.status_code == 200
        user = store["users/%s" % BAD]
        assert user["banned"] is True
        assert user["banReason"] == "Harassment"
        assert user["isOnline"] is False
        assert ("update", BAD, {"disabled": True}) in firebase_auth
        assert ("revoke", BAD) in firebase_auth
        assert store["reports/a"]["resolution"] == "banned"
        assert store["reports/b"]["resolution"] == "banned"
        assert store["reports/c"]["status"] == "open"

    def test_a_banned_account_is_refused_everywhere_at_once(self, admin, client, store, firebase_auth, monkeypatch):
        monkeypatch.setattr(app_module, "bearer_uid", lambda: BAD)
        assert client.get("/api/v1/coins/offers").status_code == 200

        admin("ban", uid=BAD, reason="Harassment")

        response = client.get("/api/v1/coins/offers")
        assert response.status_code == 403
        assert response.get_json()["code"] == "banned"

    def test_banned_accounts_leave_the_lists(self, admin, client, store, firebase_auth, monkeypatch):
        admin("ban", uid=BAD)
        monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (NICE, None))
        live = dict(isOnline=True, isSessionActive=True, isActiveMode=True, lastActive=datetime.now(timezone.utc))
        store["users/%s" % BAD].update(live)   # even if presence says otherwise
        store["users/r2"].update(live)          # the control: listed

        listed = str(client.post("/api/v1/users/recent", json={}).get_json())

        assert "Kiran" in listed
        assert "Troll" not in listed

    def test_unban_restores_sign_in(self, admin, client, store, firebase_auth, monkeypatch):
        admin("ban", uid=BAD)
        admin("ban", uid=BAD, banned=False)

        assert store["users/%s" % BAD]["banned"] is False
        assert ("update", BAD, {"disabled": False}) == firebase_auth[-1]
        monkeypatch.setattr(app_module, "bearer_uid", lambda: BAD)
        assert client.get("/api/v1/coins/offers").status_code == 200

    def test_the_banned_list_is_in_the_report(self, admin, store, firebase_auth):
        admin("ban", uid=BAD, reason="Harassment")

        body = admin("reports").get_json()

        assert body["banned"] == [{"uid": BAD, "nickname": "Troll", "reason": "Harassment",
                                   "bannedAt": body["banned"][0]["bannedAt"]}]

    def test_an_admin_cannot_be_banned(self, admin, store, monkeypatch):
        monkeypatch.setattr(app_module, "admin_uids", lambda: {ADMIN, NICE})

        assert admin("ban", uid=NICE).status_code == 400

    def test_a_failed_sign_in_switch_still_bans(self, admin, client, store, monkeypatch):
        def boom(uid, **kw):
            raise RuntimeError("auth down")
        monkeypatch.setattr(app_module.auth, "update_user", boom)

        body = admin("ban", uid=BAD).get_json()

        assert body["banned"] is True
        assert body["signInUpdated"] is False
        monkeypatch.setattr(app_module, "bearer_uid", lambda: BAD)
        assert client.get("/api/v1/coins/offers").status_code == 403
