"""The coin-purchase path: what must never credit, and what must credit once.

Everything here is a regression guard on money. The endpoint under test is the
only way coins enter a balance from a payment, and before it existed the client
credited itself.
"""
import hashlib
import hmac

import pytest

import app as app_module
from conftest import TEST_SECRET, TEST_UID
from fake_firestore import FakeFirestoreModule


ORDER_ID = "order_TEST123"
PAYMENT_ID = "pay_TEST456"


def sign(order_id, payment_id, secret=TEST_SECRET):
    return hmac.new(
        secret.encode("utf-8"),
        ("%s|%s" % (order_id, payment_id)).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@pytest.fixture
def store(monkeypatch):
    """A world with one open order for 500 coins and a user holding 100."""
    data = {
        "coin_orders/%s" % ORDER_ID: {
            "uid": TEST_UID,
            "amountInr": 449.0,
            "amountPaise": 44900,
            "coins": 500,
            "packageId": "2",
            "status": "created",
        },
        "users/%s" % TEST_UID: {"coins": 100},
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


@pytest.fixture
def captured_payment(monkeypatch):
    """Razorpay reports the payment as captured for the right order/amount."""
    def fake_get(url, **kwargs):
        class R:
            status_code = 200

            @staticmethod
            def json():
                return {"order_id": ORDER_ID, "status": "captured", "amount": 44900}
        return R()

    monkeypatch.setattr(app_module.requests, "get", fake_get)


def post_purchase(client, signature=None, payment_id=PAYMENT_ID, order_id=ORDER_ID):
    return client.post(
        "/api/v1/coins/purchase",
        json={
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature if signature is not None else sign(order_id, payment_id),
        },
    )


def balance(store):
    return store["users/%s" % TEST_UID]["coins"]


# --- things that must never credit -----------------------------------------

def test_forged_signature_is_rejected(client, as_user, store, monkeypatch):
    """A caller who invents a signature gets nothing.

    Also asserts Razorpay is never contacted: the signature check has to come
    first, or an attacker can drive request volume at the payment provider.
    """
    def explode(*a, **k):
        raise AssertionError("Razorpay must not be contacted for a bad signature")
    monkeypatch.setattr(app_module.requests, "get", explode)

    response = post_purchase(client, signature=sign(ORDER_ID, PAYMENT_ID, "wrong_secret"))

    assert response.status_code == 400
    assert balance(store) == 100
    assert store["coin_orders/%s" % ORDER_ID]["status"] == "created"


def test_missing_fields_are_rejected(client, as_user, store):
    response = client.post("/api/v1/coins/purchase", json={"razorpay_order_id": ORDER_ID})
    assert response.status_code == 400
    assert balance(store) == 100


def test_uncaptured_payment_does_not_credit(client, as_user, store, monkeypatch):
    """Authorized-but-uncaptured money has not settled and can still fall through."""
    def fake_get(url, **kwargs):
        class R:
            status_code = 200

            @staticmethod
            def json():
                return {"order_id": ORDER_ID, "status": "authorized", "amount": 44900}
        return R()
    monkeypatch.setattr(app_module.requests, "get", fake_get)

    response = post_purchase(client)

    assert response.status_code == 400
    assert balance(store) == 100


def test_amount_mismatch_does_not_credit(client, as_user, store, monkeypatch):
    """Paying ₹1 for a ₹449 order must not yield the ₹449 coin count."""
    def fake_get(url, **kwargs):
        class R:
            status_code = 200

            @staticmethod
            def json():
                return {"order_id": ORDER_ID, "status": "captured", "amount": 100}
        return R()
    monkeypatch.setattr(app_module.requests, "get", fake_get)

    response = post_purchase(client)

    assert response.status_code == 400
    assert balance(store) == 100


def test_another_users_order_does_not_credit(client, as_user, store, captured_payment):
    store["coin_orders/%s" % ORDER_ID]["uid"] = "somebody_else"

    response = post_purchase(client)

    assert response.status_code == 400
    assert balance(store) == 100


def test_unknown_order_does_not_credit(client, as_user, store, captured_payment):
    del store["coin_orders/%s" % ORDER_ID]

    response = post_purchase(client)

    assert response.status_code == 400
    assert balance(store) == 100


def test_payment_for_a_different_order_is_rejected(client, as_user, store, monkeypatch):
    def fake_get(url, **kwargs):
        class R:
            status_code = 200

            @staticmethod
            def json():
                return {"order_id": "order_SOMETHINGELSE", "status": "captured", "amount": 44900}
        return R()
    monkeypatch.setattr(app_module.requests, "get", fake_get)

    response = post_purchase(client)

    assert response.status_code == 400
    assert balance(store) == 100


# --- the one thing that must credit, exactly once ---------------------------

def test_valid_payment_credits_the_frozen_coin_count(client, as_user, store, captured_payment):
    response = post_purchase(client)

    assert response.status_code == 200
    body = response.get_json()
    assert body["coinsCredited"] == 500
    assert body["newBalance"] == 600
    assert balance(store) == 600
    order = store["coin_orders/%s" % ORDER_ID]
    assert order["status"] == "paid"
    assert order["paymentId"] == PAYMENT_ID


def test_replay_does_not_credit_twice(client, as_user, store, captured_payment):
    """The same receipt submitted twice credits once.

    This is the guard that matters most: a retried request after a dropped
    response must be safe, and a deliberately replayed one must be useless.
    """
    first = post_purchase(client)
    assert first.status_code == 200
    assert balance(store) == 600

    second = post_purchase(client)

    assert second.status_code == 200
    assert second.get_json()["coinsCredited"] == 0
    assert balance(store) == 600


def test_second_payment_against_a_paid_order_is_rejected(client, as_user, store, captured_payment):
    """A *different* payment id on an already-paid order is not an idempotent retry."""
    post_purchase(client)
    assert balance(store) == 600

    other = "pay_OTHER789"
    response = post_purchase(client, payment_id=other, signature=sign(ORDER_ID, other))

    assert response.status_code == 400
    assert balance(store) == 600
