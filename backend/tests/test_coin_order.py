"""Opening a top-up order: bounds, coin yield, and what the client cannot decide."""
import math

import pytest

import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


@pytest.fixture
def store(monkeypatch):
    data = {"settings/pricing": {"inrToCoinRechargeRate": 1.12, "minRechargeAmount": 49}}
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


@pytest.fixture
def razorpay_accepts(monkeypatch):
    """Razorpay opens the order; capture what we asked it for."""
    sent = {}

    def fake_post(url, **kwargs):
        sent.update(kwargs.get("json") or {})

        class R:
            status_code = 200

            @staticmethod
            def json():
                return {"id": "order_NEW"}
        return R()

    monkeypatch.setattr(app_module.requests, "post", fake_post)
    return sent


def test_coin_yield_is_floored_like_the_client(store):
    """`coinsFor` on the store screen floors; the server must agree exactly.

    A server that rounded up would quote one number and credit another.
    """
    settings = {"inrToCoinRechargeRate": 1.12}
    for amount in (89, 449, 899, 1799, 49, 137):
        assert app_module.coins_for_inr(amount, settings) == math.floor(amount * 1.12)


def test_order_freezes_the_coin_count(client, as_user, store, razorpay_accepts):
    """The yield is written onto the order, not recomputed at payment time.

    A rate change while checkout is open must not re-price a quoted order.
    """
    response = client.post("/api/v1/coins/order", json={"amountInr": 449, "packageId": "2"})

    assert response.status_code == 200
    assert response.get_json()["coins"] == math.floor(449 * 1.12)
    assert store["coin_orders/order_NEW"]["coins"] == math.floor(449 * 1.12)
    assert store["coin_orders/order_NEW"]["uid"] == TEST_UID
    assert store["coin_orders/order_NEW"]["status"] == "created"


def test_client_cannot_dictate_the_coin_count(client, as_user, store, razorpay_accepts):
    """Extra fields in the request body are ignored, not trusted."""
    response = client.post(
        "/api/v1/coins/order",
        json={"amountInr": 49, "coins": 999999, "amountPaise": 1},
    )

    assert response.status_code == 200
    assert response.get_json()["coins"] == math.floor(49 * 1.12)
    assert store["coin_orders/order_NEW"]["amountPaise"] == 4900


def test_amount_is_sent_to_razorpay_in_paise(client, as_user, store, razorpay_accepts):
    client.post("/api/v1/coins/order", json={"amountInr": 449})
    assert razorpay_accepts["amount"] == 44900
    assert razorpay_accepts["currency"] == "INR"


def test_below_minimum_is_rejected(client, as_user, store, razorpay_accepts):
    response = client.post("/api/v1/coins/order", json={"amountInr": 10})
    assert response.status_code == 400
    assert "coin_orders/order_NEW" not in store


def test_above_maximum_is_rejected(client, as_user, store, razorpay_accepts):
    response = client.post("/api/v1/coins/order", json={"amountInr": 500000})
    assert response.status_code == 400
    assert "coin_orders/order_NEW" not in store


def test_non_numeric_amount_is_rejected(client, as_user, store, razorpay_accepts):
    response = client.post("/api/v1/coins/order", json={"amountInr": "many"})
    assert response.status_code == 400


def test_negative_amount_is_rejected(client, as_user, store, razorpay_accepts):
    response = client.post("/api/v1/coins/order", json={"amountInr": -449})
    assert response.status_code == 400
    assert "coin_orders/order_NEW" not in store


def test_provider_failure_opens_no_order(client, as_user, store, monkeypatch):
    """If Razorpay rejects the order, nothing is left behind to be paid against."""
    def fake_post(url, **kwargs):
        class R:
            status_code = 500
            text = "provider down"

            @staticmethod
            def json():
                return {}
        return R()
    monkeypatch.setattr(app_module.requests, "post", fake_post)

    response = client.post("/api/v1/coins/order", json={"amountInr": 449})

    assert response.status_code == 502
    assert not [k for k in store if k.startswith("coin_orders/")]


def test_payments_ready_never_returns_the_secret(monkeypatch):
    """It is a predicate. Returning the key from the `and` chain invites a log line."""
    assert app_module.payments_ready() is True
    monkeypatch.setattr(app_module, "PAYMENT_PROVIDER", "")
    assert app_module.payments_ready() is False
