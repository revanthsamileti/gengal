"""Coupon codes: the admin makes them, a user redeems one once for coins."""
from datetime import datetime, timedelta, timezone

import pytest

import app as app_module
from fake_firestore import FakeFirestoreModule


ADMIN = "admin_uid"
ME = "user_a"
OTHER = "user_b"


@pytest.fixture
def store(monkeypatch):
    data = {"users/%s" % ME: {"coins": 10}, "users/%s" % OTHER: {"coins": 0}}
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    monkeypatch.setattr(app_module, "_rate_buckets", {})
    return data


@pytest.fixture
def admin(client, monkeypatch):
    def post(**body):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (ADMIN, None))
        return client.post("/api/v1/admin/coupons", json=body)
    return post


@pytest.fixture
def redeem(client, monkeypatch):
    def post(uid, code):
        monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (uid, None))
        return client.post("/api/v1/coupons/redeem", json={"code": code})
    return post


def coins(store, uid):
    return store["users/%s" % uid]["coins"]


def test_a_new_code_is_worth_100_by_default(admin, redeem, store):
    code = admin(action="create", code="grab100").get_json()["code"]

    response = redeem(ME, "grab100")

    assert code == "GRAB100"
    assert response.status_code == 200
    assert response.get_json()["coins"] == 100
    assert coins(store, ME) == 110


def test_once_per_person(admin, redeem, store):
    admin(action="create", code="GRAB100")
    redeem(ME, "GRAB100")

    again = redeem(ME, "GRAB100")

    assert again.status_code == 400
    assert "already used" in again.get_json()["error"]
    assert coins(store, ME) == 110


def test_a_capped_code_runs_out(admin, redeem, store):
    admin(action="create", code="ONLY1", coins=50, maxUses=1)
    redeem(ME, "ONLY1")

    response = redeem(OTHER, "ONLY1")

    assert response.status_code == 400
    assert "used up" in response.get_json()["error"]
    assert coins(store, OTHER) == 0


def test_an_expired_code_is_refused(admin, redeem, store):
    admin(action="create", code="OLDCODE", days=1)
    store["coupons/OLDCODE"]["expiresAt"] = datetime.now(timezone.utc) - timedelta(minutes=1)

    assert redeem(ME, "OLDCODE").status_code == 400
    assert coins(store, ME) == 10


def test_a_switched_off_code_is_refused_and_can_come_back(admin, redeem, store):
    admin(action="create", code="PAUSEME")
    admin(action="disable", code="PAUSEME")

    assert redeem(ME, "PAUSEME").status_code == 400

    admin(action="enable", code="PAUSEME")
    assert redeem(ME, "PAUSEME").status_code == 200


def test_unknown_and_malformed_codes(redeem, store):
    assert "does not exist" in redeem(ME, "NOSUCH").get_json()["error"]
    assert redeem(ME, "x").status_code == 400


def test_guessing_is_slowed_down(redeem, store):
    for _ in range(8):
        redeem(ME, "GUESS1")

    assert redeem(ME, "GUESS2").status_code == 429


def test_a_blank_code_is_made_up_and_listed(admin, store):
    code = admin(action="create", coins=25).get_json()["code"]

    listed = admin(action="list").get_json()["coupons"]

    assert len(code) == 8
    assert listed[0]["code"] == code
    assert listed[0]["coins"] == 25 and listed[0]["uses"] == 0 and listed[0]["active"] is True


def test_duplicate_and_silly_amounts_are_refused(admin, store):
    admin(action="create", code="TWICE")

    assert admin(action="create", code="TWICE").status_code == 400
    assert admin(action="create", code="ZERO", coins=0).status_code == 400


def test_admins_only(client, store, monkeypatch):
    monkeypatch.setattr(app_module, "require_admin_uid", lambda: (None, ({"error": "no"}, 403)))

    assert client.post("/api/v1/admin/coupons", json={"action": "create"}).status_code == 403
