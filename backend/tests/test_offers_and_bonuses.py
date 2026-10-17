"""Offers and bonuses the admin controls: the store discount, the first-purchase
pack, the daily bonus for talking, and the daily host bonus.

The owner's numbers (₹8 = 10 coins, 10/min voice, 50/min video, ₹6 for 60
coins once, 30 coins a day after 5 paid voice minutes, a pool for the top 10
hosts who talked 30+ minutes) are all settings; these tests pin the money each
one moves.
"""
from datetime import datetime, timedelta, timezone

import pytest

import app as app_module
from conftest import TEST_UID, TEST_SECRET
from fake_firestore import FakeFirestoreModule
import hashlib
import hmac


ADMIN = "admin_uid"
HOSTS = ["host_%d" % i for i in range(12)]


def today():
    return app_module.ist_day(datetime.now(timezone.utc))


def yesterday():
    return app_module.ist_day(datetime.now(timezone.utc) - timedelta(days=1))


@pytest.fixture
def store(monkeypatch):
    data = {
        "settings/pricing": {"inrToCoinRechargeRate": 1.25, "minRechargeAmount": 49},
        "users/%s" % TEST_UID: {"coins": 100, "hearts": 0},
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


@pytest.fixture
def razorpay(monkeypatch):
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


def settings(store, **values):
    store["settings/pricing"].update(values)


def order(client, package, amount):
    return client.post("/api/v1/coins/order", json={"packageId": package, "amountInr": amount})


# ── Store discount ──────────────────────────────────────────────────────────


class TestDiscount:
    def test_a_discount_is_a_lower_price_for_the_same_coins(self, store):
        s = dict(app_module.DEFAULT_SETTINGS, inrToCoinRechargeRate=1.25, coinDiscountPercent=20)
        # The ₹449 pack at 20% off is ₹359.20 and still buys ₹449's coins.
        assert app_module.coins_for_inr(449 * 0.8, s) == 561
        assert app_module.coins_for_inr(449, dict(s, coinDiscountPercent=0)) == 561

    def test_the_minimum_applies_to_the_full_price(self, client, as_user, store, razorpay):
        settings(store, coinDiscountPercent=20)

        assert order(client, "1", 40).status_code == 200   # full price ₹50
        assert order(client, "1", 38).status_code == 400   # full price ₹47.50

    def test_a_discount_cannot_be_set_past_half_price(self, client, store, monkeypatch):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (ADMIN, None))

        response = client.post("/api/v1/admin/settings", json={"settings": {"coinDiscountPercent": 60}})

        assert response.status_code == 400


# ── First purchase ──────────────────────────────────────────────────────────


def paid(store, order_id, coins, amount_inr, package):
    store["coin_orders/%s" % order_id] = {
        "uid": TEST_UID, "amountInr": amount_inr, "amountPaise": int(amount_inr * 100),
        "coins": coins, "packageId": package, "status": "created",
    }


def confirm(client, monkeypatch, order_id, amount_inr):
    payment_id = "pay_" + order_id

    def fake_get(url, **kwargs):
        class R:
            status_code = 200

            @staticmethod
            def json():
                return {"order_id": order_id, "status": "captured", "amount": int(amount_inr * 100)}
        return R()

    monkeypatch.setattr(app_module.requests, "get", fake_get)
    signature = hmac.new(TEST_SECRET.encode(), ("%s|%s" % (order_id, payment_id)).encode(), hashlib.sha256).hexdigest()
    return client.post("/api/v1/coins/purchase", json={
        "razorpay_order_id": order_id, "razorpay_payment_id": payment_id, "razorpay_signature": signature,
    })


class TestFirstBuy:
    def test_six_rupees_for_sixty_coins(self, client, as_user, store, razorpay):
        response = order(client, "first_buy", 6)

        assert response.status_code == 200, response.get_json()
        assert store["coin_orders/order_NEW"]["coins"] == 60
        assert razorpay["amount"] == 600

    def test_the_offer_shows_until_the_first_recharge(self, client, as_user, store, monkeypatch):
        assert client.get("/api/v1/coins/offers").get_json()["firstBuy"] == {"priceInr": 6, "coins": 60}

        paid(store, "order_A", 61, 49, "1")
        confirm(client, monkeypatch, "order_A", 49)

        assert client.get("/api/v1/coins/offers").get_json()["firstBuy"] is None

    def test_not_for_somebody_who_has_recharged_before(self, client, as_user, store, razorpay):
        store["coin_orders/old"] = {"uid": TEST_UID, "status": "paid"}

        assert order(client, "first_buy", 6).status_code == 400

    def test_the_price_must_be_the_offer_price(self, client, as_user, store, razorpay):
        assert order(client, "first_buy", 1).status_code == 400

    def test_switched_off_with_zero_coins(self, client, as_user, store, razorpay):
        settings(store, firstBuyCoins=0)

        assert order(client, "first_buy", 6).status_code == 400
        assert client.get("/api/v1/coins/offers").get_json()["firstBuy"] is None

    def test_a_second_first_buy_paid_later_gets_the_ordinary_rate(self, client, as_user, store, monkeypatch):
        paid(store, "order_A", 60, 6, "first_buy")
        paid(store, "order_B", 60, 6, "first_buy")

        confirm(client, monkeypatch, "order_A", 6)
        confirm(client, monkeypatch, "order_B", 6)

        # 100 + 60 for the offer + floor(6 x 1.25) = 7 for the second.
        assert store["users/%s" % TEST_UID]["coins"] == 167


# ── Billing keeps the day's totals ──────────────────────────────────────────


CALL = "call_1"
HOST = "host_x"


def call(store, mode="voice", seconds=60):
    store["users/%s" % HOST] = {"coins": 0, "hearts": 0}
    store["calls/%s" % CALL] = {
        "callerUid": TEST_UID, "receiverUid": HOST, "mode": mode, "status": "active",
        "lastBilledAt": datetime.now(timezone.utc) - timedelta(seconds=seconds),
        "durationSeconds": 0, "coinsDeducted": 0,
    }


class TestDayTotals:
    def test_a_voice_minute_counts_for_the_caller_and_the_host(self, client, as_user, store):
        settings(store, voiceCallRatePerMin=10, creatorSharePercentage=70)
        call(store, "voice", 60)

        client.post("/api/v1/coins/call-billing", json={"roomId": CALL})

        me = store["user_days/%s_%s" % (today(), TEST_UID)]
        host = store["user_days/%s_%s" % (today(), HOST)]
        assert me["paidVoiceSecs"] == pytest.approx(60, abs=1)
        assert me["spentCoins"] == pytest.approx(10, abs=0.2)
        assert host["hostSecs"] == pytest.approx(60, abs=1)

    def test_video_counts_for_the_host_but_not_the_voice_bonus(self, client, as_user, store):
        settings(store, videoCallRatePerMin=50)
        call(store, "video", 60)

        client.post("/api/v1/coins/call-billing", json={"roomId": CALL})

        assert store["user_days/%s_%s" % (today(), TEST_UID)]["paidVoiceSecs"] == 0
        assert store["user_days/%s_%s" % (today(), HOST)]["hostSecs"] == pytest.approx(60, abs=1)

    def test_unpaid_seconds_count_for_nobody(self, client, as_user, store):
        settings(store, voiceCallRatePerMin=10)
        store["users/%s" % TEST_UID]["coins"] = 5   # half a minute's worth
        call(store, "voice", 60)

        client.post("/api/v1/coins/call-billing", json={"roomId": CALL})

        assert store["user_days/%s_%s" % (today(), HOST)]["hostSecs"] == pytest.approx(30, abs=1)


# ── Daily bonus ─────────────────────────────────────────────────────────────


def talked(store, uid, minutes, day=None):
    store["user_days/%s_%s" % (day or today(), uid)] = {
        "uid": uid, "day": day or today(), "paidVoiceSecs": minutes * 60, "spentCoins": minutes * 10,
        "hostSecs": 0, "bonusClaimed": False,
    }


class TestDailyBonus:
    def test_locked_until_five_paid_voice_minutes(self, client, as_user, store):
        talked(store, TEST_UID, 3)

        status = client.get("/api/v1/bonus/daily").get_json()
        response = client.post("/api/v1/bonus/daily")

        assert status["canClaim"] is False
        assert response.status_code == 400
        assert "2 more minute" in response.get_json()["error"]
        assert store["users/%s" % TEST_UID]["coins"] == 100

    def test_thirty_coins_once_unlocked(self, client, as_user, store):
        talked(store, TEST_UID, 5)

        response = client.post("/api/v1/bonus/daily")

        assert response.status_code == 200
        assert store["users/%s" % TEST_UID]["coins"] == 130

    def test_once_a_day(self, client, as_user, store):
        talked(store, TEST_UID, 9)
        client.post("/api/v1/bonus/daily")

        assert client.post("/api/v1/bonus/daily").status_code == 400
        assert store["users/%s" % TEST_UID]["coins"] == 130

    def test_yesterdays_talk_does_not_count(self, client, as_user, store):
        talked(store, TEST_UID, 9, day=yesterday())

        assert client.post("/api/v1/bonus/daily").status_code == 400

    def test_amount_and_minutes_are_settings(self, client, as_user, store):
        settings(store, dailyBonusCoins=50, dailyBonusMinVoiceMinutes=2)
        talked(store, TEST_UID, 2)

        client.post("/api/v1/bonus/daily")

        assert store["users/%s" % TEST_UID]["coins"] == 150

    def test_zero_coins_switches_it_off(self, client, as_user, store):
        settings(store, dailyBonusCoins=0)
        talked(store, TEST_UID, 9)

        assert client.post("/api/v1/bonus/daily").status_code == 400


# ── Host bonus ──────────────────────────────────────────────────────────────


@pytest.fixture
def admin(client, monkeypatch):
    monkeypatch.setattr(app_module, "require_admin_uid", lambda: (ADMIN, None))

    def post(**body):
        return client.post("/api/v1/admin/host-bonus", json=body)
    return post


def hosts_talked(store, minutes_each, day=None):
    """Host i talked minutes_each[i] minutes; the callers spent 10 coins a minute."""
    day = day or yesterday()
    for uid, minutes in zip(HOSTS, minutes_each):
        store["users/%s" % uid] = {"nickname": uid, "hearts": 0}
        store["user_days/%s_%s" % (day, uid)] = {
            "uid": uid, "day": day, "hostSecs": minutes * 60, "paidVoiceSecs": 0, "spentCoins": 0,
        }
    store["user_days/%s_payer" % day] = {
        "uid": "payer", "day": day, "spentCoins": sum(minutes_each) * 10, "paidVoiceSecs": 0, "hostSecs": 0,
    }


class TestHostBonus:
    def test_the_top_ten_who_talked_thirty_minutes_share_the_pool(self, admin, store):
        settings(store, hostBonusPoolPercent=10, heartToInrRate=3)
        hosts_talked(store, [90, 80, 70, 60, 55, 50, 45, 40, 35, 33, 31, 20])

        plan = admin(action="preview").get_json()

        # Revenue: 609 minutes x 10 coins = 6,090 coins = ₹4,872. Pool 10%.
        assert plan["revenueInr"] == pytest.approx(4872)
        assert plan["poolInr"] == pytest.approx(487.2)
        assert [w["uid"] for w in plan["winners"]] == HOSTS[:10]   # 31 min is 11th, 20 min too short
        assert plan["winners"][0]["inr"] == pytest.approx(121.8)   # 25% of the pool
        assert plan["winners"][0]["hearts"] == pytest.approx(40.6, abs=0.01)

    def test_the_admin_can_name_the_amount(self, admin, store):
        hosts_talked(store, [40, 35])

        plan = admin(action="preview", amountInr=1000).get_json()

        assert plan["poolInr"] == 1000
        assert sum(w["inr"] for w in plan["winners"]) == pytest.approx(1000, abs=0.05)

    def test_paying_credits_hearts_once(self, admin, store):
        settings(store, heartToInrRate=2)
        hosts_talked(store, [40])

        assert admin(action="pay", amountInr=100).status_code == 200
        assert admin(action="pay", amountInr=100).status_code == 400

        assert store["users/%s" % HOSTS[0]]["hearts"] == pytest.approx(50)

    def test_today_cannot_be_paid_until_it_is_over(self, admin, store):
        hosts_talked(store, [40], day=today())

        assert admin(action="pay", day=today(), amountInr=100).status_code == 400

    def test_minimum_minutes_and_winner_count_are_settings(self, admin, store):
        settings(store, hostBonusMinMinutes=10, hostBonusTopCount=3)
        hosts_talked(store, [12, 11, 50, 9, 40])

        plan = admin(action="preview").get_json()

        assert [w["uid"] for w in plan["winners"]] == [HOSTS[2], HOSTS[4], HOSTS[0]]

    def test_the_pool_cannot_be_set_above_half_the_revenue(self, client, store, monkeypatch):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (ADMIN, None))

        response = client.post("/api/v1/admin/settings", json={"settings": {"hostBonusPoolPercent": 100}})

        assert response.status_code == 400

    def test_admins_only(self, client, store, monkeypatch):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (None, ({"error": "no"}, 403)))

        assert client.post("/api/v1/admin/host-bonus", json={"action": "preview"}).status_code == 403
