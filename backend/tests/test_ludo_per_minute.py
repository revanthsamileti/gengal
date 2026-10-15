"""Per-minute Ludo tables: deposit, per-minute play, host limits, one game at a time.

The rules come from the product owner and are summarised above
LUDO_PER_MINUTE in app.py. These tests pin the money each one moves.
"""

from datetime import datetime, timedelta, timezone

import pytest

import app as app_module
from fake_firestore import FakeFirestoreModule


HOST = "pm_host"
P1, P2, P3 = "pm_p1", "pm_p2", "pm_p3"
OUTSIDER = "pm_outsider"


def now():
    return datetime.now(timezone.utc)


@pytest.fixture
def store(monkeypatch):
    data = {
        "users/%s" % HOST: {"coins": 200},
        "users/%s" % P1: {"coins": 100},
        "users/%s" % P2: {"coins": 100},
        "users/%s" % P3: {"coins": 100},
        "users/%s" % OUTSIDER: {"coins": 100},
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


@pytest.fixture
def act(client, monkeypatch):
    """POST as a given user."""
    def post(uid, path, **body):
        monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (uid, None))
        return client.post("/api/v1/ludo/" + path, json=body)
    return post


def coins(store, uid):
    return store["users/%s" % uid]["coins"]


def room(store, room_id):
    return store["ludo_rooms/%s" % room_id]


def here(store, room_id, *uids, ago=0):
    """Heartbeats, as the phones write them."""
    for uid in uids:
        store["ludo_rooms/%s/members/%s" % (room_id, uid)] = {"lastSeen": now() - timedelta(seconds=ago)}


def open_table(act, store):
    response = act(HOST, "create-table", gameMode="per_minute", nickname="Host")
    assert response.status_code == 200, response.get_json()
    return response.get_json()["roomId"]


def seat(act, uid, room_id, color):
    response = act(uid, "buy-ticket", roomId=room_id, color=color, nickname=uid)
    assert response.status_code == 200, response.get_json()


def started_table(act, store, *players):
    room_id = open_table(act, store)
    for uid, color in zip(players, ("blue", "green", "yellow")):
        seat(act, uid, room_id, color)
    here(store, room_id, HOST, *players)
    response = act(HOST, "start", roomId=room_id)
    assert response.status_code == 200, response.get_json()
    return room_id


def minute_passes(store, room_id):
    room(store, room_id)["billedUntil"] = now() - timedelta(seconds=1)


class TestOpening:
    def test_opening_takes_the_50_deposit_and_records_the_terms(self, act, store):
        room_id = open_table(act, store)

        assert coins(store, HOST) == 150
        terms = room(store, room_id)["terms"]
        assert terms["deposit"] == 50
        assert terms["rates"] == {"1": 10, "2": 12, "3": 15}
        assert terms["hostSharePercent"] == 30
        assert room(store, room_id)["ticketPrice"] == 0
        assert store["users/%s" % HOST]["activeLudoRoomId"] == room_id

    def test_terms_follow_the_admin_settings(self, act, store):
        store["settings/pricing"] = {"ludoHostDeposit": 80, "ludoRateTwoPlayers": 20}
        room_id = open_table(act, store)

        assert coins(store, HOST) == 120
        assert room(store, room_id)["terms"]["rates"]["2"] == 20

    def test_older_apps_still_open_the_old_table_for_10(self, act, store):
        response = act(HOST, "create-table", gameMode="per_game", nickname="Host")

        assert response.status_code == 200
        assert coins(store, HOST) == 190

    def test_cannot_open_without_the_deposit(self, act, store):
        store["users/%s" % HOST]["coins"] = 49

        response = act(HOST, "create-table", gameMode="per_minute", nickname="Host")

        assert response.status_code == 400
        assert coins(store, HOST) == 49

    def test_host_closing_before_the_game_gets_the_deposit_back(self, act, store):
        room_id = open_table(act, store)

        response = act(HOST, "leave-seat", roomId=room_id)

        assert response.status_code == 200
        assert coins(store, HOST) == 200
        assert room(store, room_id)["status"] == "closed"


class TestOneGameAtATime:
    def test_a_host_cannot_open_a_second_table(self, act, store):
        first = open_table(act, store)

        response = act(HOST, "create-table", gameMode="per_minute", nickname="Host")

        assert response.status_code == 409
        assert response.get_json()["code"] == "ludo_busy"
        assert response.get_json()["roomId"] == first
        assert coins(store, HOST) == 150

    def test_a_host_cannot_sit_at_somebody_elses_table(self, act, store):
        open_table(act, store)
        other = act(P1, "create-table", gameMode="per_minute", nickname="P1").get_json()["roomId"]

        response = act(HOST, "buy-ticket", roomId=other, color="blue", nickname="Host")

        assert response.status_code == 409

    def test_a_player_cannot_open_or_join_another_table_mid_game(self, act, store):
        started_table(act, store, P1)
        other = act(P2, "create-table", gameMode="per_minute", nickname="P2").get_json()["roomId"]

        assert act(P1, "buy-ticket", roomId=other, color="blue", nickname="P1").status_code == 409
        assert act(P1, "create-table", gameMode="per_minute", nickname="P1").status_code == 409

    def test_a_player_who_quits_mid_game_stays_committed_until_it_ends(self, act, store):
        room_id = started_table(act, store, P1, P2)
        act(P1, "leave-seat", roomId=room_id)

        response = act(P1, "create-table", gameMode="per_minute", nickname="P1")

        assert response.status_code == 409

    def test_a_player_whose_pawns_are_all_home_is_free(self, act, store):
        room_id = started_table(act, store, P1, P2)
        for token in room(store, room_id)["tokens"]:
            if token["color"] == "blue":
                token["position"] = app_module.LUDO_FINISHED_POSITION

        response = act(P1, "create-table", gameMode="per_minute", nickname="P1")

        assert response.status_code == 200

    def test_a_finished_game_frees_everybody(self, act, store):
        room_id = started_table(act, store, P1)
        room(store, room_id)["phase"] = "finished"

        assert act(HOST, "create-table", gameMode="per_minute", nickname="Host").status_code == 200

    def test_an_abandoned_waiting_table_frees_its_host_and_refunds(self, act, store):
        first = open_table(act, store)
        room(store, first)["hostLastSeen"] = now() - timedelta(minutes=5)

        response = act(HOST, "create-table", gameMode="per_minute", nickname="Host")

        assert response.status_code == 200
        # 200 - 50 (first) + 50 (refund) - 50 (second)
        assert coins(store, HOST) == 150
        assert room(store, first)["status"] == "closed"


class TestPerMinute:
    def test_seats_are_free(self, act, store):
        room_id = open_table(act, store)

        seat(act, P1, room_id, "blue")

        assert coins(store, P1) == 100

    def test_start_charges_the_first_minute_and_pays_the_host_30_percent(self, act, store):
        started_table(act, store, P1, P2)

        assert coins(store, P1) == 88
        assert coins(store, P2) == 88
        # 30% of 12, twice.
        assert coins(store, HOST) == pytest.approx(150 + 7.2)

    def test_rate_follows_the_number_of_players(self, act, store):
        started_table(act, store, P1, P2, P3)

        assert coins(store, P1) == 85

    def test_nothing_more_is_due_until_the_minute_is_up(self, act, store):
        room_id = started_table(act, store, P1)

        act(P1, "tick", roomId=room_id)

        assert coins(store, P1) == 90

    def test_each_new_minute_is_charged_once(self, act, store):
        room_id = started_table(act, store, P1)
        minute_passes(store, room_id)

        act(P1, "tick", roomId=room_id)
        act(HOST, "tick", roomId=room_id)

        assert coins(store, P1) == 80
        assert coins(store, HOST) == pytest.approx(150 + 3 + 3)

    def test_a_player_whose_phone_is_closed_is_not_charged(self, act, store):
        room_id = started_table(act, store, P1, P2)
        here(store, room_id, P2, ago=300)
        room(store, room_id)["lastActive"] = {}
        minute_passes(store, room_id)

        act(P1, "tick", roomId=room_id)

        assert coins(store, P1) == 76
        assert coins(store, P2) == 88

    def test_a_player_who_cannot_pay_loses_the_seat(self, act, store):
        room_id = started_table(act, store, P1, P2)
        store["users/%s" % P2]["coins"] = 5
        minute_passes(store, room_id)

        act(P1, "tick", roomId=room_id)

        r = room(store, room_id)
        assert P2 not in r["playerUids"]
        assert P2 in r["departedUids"]
        assert coins(store, P2) == 5
        assert all(t["position"] == -1 for t in r["tokens"] if t["color"] == "green")

    def test_a_seat_needs_a_minutes_coins(self, act, store):
        room_id = open_table(act, store)
        store["users/%s" % P1]["coins"] = 9

        response = act(P1, "buy-ticket", roomId=room_id, color="blue", nickname="P1")

        assert response.status_code == 400


class TestHostLimits:
    def test_three_comebacks_are_allowed(self, act, store):
        room_id = started_table(act, store, P1)
        for _ in range(3):
            act(HOST, "tick", roomId=room_id, here=False)
            act(HOST, "tick", roomId=room_id, here=True)

        assert room(store, room_id)["hostLeaves"] == 3
        assert room(store, room_id)["hostBenched"] is False

    def test_the_fourth_departure_benches_the_host(self, act, store):
        room_id = started_table(act, store, P1)
        for _ in range(4):
            act(HOST, "tick", roomId=room_id, here=False)
            act(HOST, "tick", roomId=room_id, here=True)

        assert room(store, room_id)["hostBenched"] is True

    def test_leaving_the_board_screen_counts_as_a_departure(self, act, store):
        room_id = started_table(act, store, P1)

        act(HOST, "leave-seat", roomId=room_id)

        r = room(store, room_id)
        assert HOST in r["playerUids"]
        assert r["hostLeaves"] == 1

    def test_a_quiet_heartbeat_counts_as_a_departure(self, act, store):
        room_id = started_table(act, store, P1)
        room(store, room_id)["hostLastSeen"] = now() - timedelta(minutes=2)

        act(P1, "tick", roomId=room_id)

        assert room(store, room_id)["hostLeaves"] == 1

    def expire_host_turn(self, store, room_id):
        r = room(store, room_id)
        r["currentTurn"] = "red"
        r["diceRolled"] = False
        r["turnStartedAt"] = now() - timedelta(seconds=40)

    def test_the_fourth_missed_turn_benches_the_host(self, act, store):
        room_id = started_table(act, store, P1)
        for _ in range(3):
            self.expire_host_turn(store, room_id)
            assert act(P1, "skip", roomId=room_id).status_code == 200
        assert room(store, room_id)["hostBenched"] is False

        self.expire_host_turn(store, room_id)
        act(P1, "skip", roomId=room_id)

        assert room(store, room_id)["hostMissed"] == 4
        assert room(store, room_id)["hostBenched"] is True

    def test_a_benched_host_is_passed_over_and_cannot_roll(self, act, store):
        room_id = started_table(act, store, P1)
        r = room(store, room_id)
        r["hostBenched"] = True
        r["currentTurn"] = "red"

        assert act(HOST, "roll", roomId=room_id).status_code == 400
        # Nobody has to wait out the clock on a benched host's turn.
        assert act(P1, "skip", roomId=room_id).status_code == 200
        assert room(store, room_id)["currentTurn"] == "blue"

    def test_a_benched_host_stops_earning(self, act, store):
        room_id = started_table(act, store, P1)
        room(store, room_id)["hostBenched"] = True
        before = coins(store, HOST)
        minute_passes(store, room_id)

        act(P1, "tick", roomId=room_id)

        assert coins(store, HOST) == before
        assert coins(store, P1) == 80


def finish_blue(store, room_id):
    """Blue is one step from home with the die showing 1."""
    r = room(store, room_id)
    for token in r["tokens"]:
        if token["color"] == "blue":
            token["position"] = app_module.LUDO_FINISHED_POSITION
    r["tokens"][4]["position"] = 56  # blue-0, last square before home
    r["currentTurn"] = "blue"
    r["diceRolled"] = True
    r["diceValue"] = 1


class TestSettlement:
    def test_host_who_stayed_keeps_nothing_back_and_the_winner_gets_the_bonus(self, act, store):
        room_id = started_table(act, store, P1)
        finish_blue(store, room_id)
        host_before, p1_before = coins(store, HOST), coins(store, P1)

        response = act(P1, "move", roomId=room_id, tokenId="blue-0")

        assert response.status_code == 200, response.get_json()
        r = room(store, room_id)
        assert r["phase"] == "finished"
        assert r["settlement"]["depositToApp"] == 50
        assert coins(store, HOST) == host_before
        assert coins(store, P1) == p1_before + 20

    def test_a_benched_hosts_deposit_is_split_among_the_players_left(self, act, store):
        room_id = started_table(act, store, P1, P2)
        room(store, room_id)["hostBenched"] = True
        finish_blue(store, room_id)
        p1, p2 = coins(store, P1), coins(store, P2)

        act(P1, "move", roomId=room_id, tokenId="blue-0")

        # Green still racing, so the game is not over yet.
        assert room(store, room_id)["phase"] == "playing"

        r = room(store, room_id)
        for token in r["tokens"]:
            if token["color"] == "green":
                token["position"] = app_module.LUDO_FINISHED_POSITION
        r["tokens"][8]["position"] = 56  # green-0
        r["currentTurn"] = "green"
        r["diceRolled"] = True
        r["diceValue"] = 1
        act(P2, "move", roomId=room_id, tokenId="green-0")

        r = room(store, room_id)
        assert r["phase"] == "finished"
        # Two players left: 15 each, 20 to the app; P1 also won.
        assert r["settlement"]["depositToPlayers"] == {P1: 15, P2: 15}
        assert r["settlement"]["depositToApp"] == 20
        assert coins(store, P1) == pytest.approx(p1 + 15 + 20)
        assert coins(store, P2) == pytest.approx(p2 + 15)

    @pytest.mark.parametrize("players,each,app_share", [
        ((P1,), 25, 25),
        ((P1, P2), 15, 20),
        ((P1, P2, P3), 10, 20),
    ])
    def test_forfeit_split_by_players_left(self, players, each, app_share):
        r = {
            "hostUid": HOST,
            "hostBenched": True,
            "terms": app_module.ludo_terms(app_module.LUDO_SETTING_DEFAULTS),
            "players": [{"uid": HOST, "color": "red"}] + [{"uid": u} for u in players],
            "winnersOrder": [],
        }

        class Ledger:
            def __init__(self):
                self.paid = {}

            def add(self, uid, amount):
                self.paid[uid] = self.paid.get(uid, 0) + amount

        ledger = Ledger()
        app_module.ludo_settle(r, ledger, "game_over")

        assert ledger.paid == {u: each for u in players}
        assert r["settlement"]["depositToApp"] == app_share

    def test_a_game_is_paid_out_once(self, act, store):
        room_id = started_table(act, store, P1)
        finish_blue(store, room_id)
        act(P1, "move", roomId=room_id, tokenId="blue-0")
        after = coins(store, P1)

        act(P1, "tick", roomId=room_id)
        act(HOST, "tick", roomId=room_id)

        assert coins(store, P1) == after

    def test_split_never_exceeds_the_deposit(self):
        terms = app_module.ludo_terms(dict(app_module.LUDO_SETTING_DEFAULTS, ludoForfeitThreePlayers=40))
        r = {
            "hostUid": HOST, "hostBenched": True, "terms": terms, "winnersOrder": [],
            "players": [{"uid": HOST}, {"uid": P1}, {"uid": P2}, {"uid": P3}],
        }
        paid = {}

        class Ledger:
            def add(self, uid, amount):
                paid[uid] = amount

        app_module.ludo_settle(r, Ledger(), "game_over")

        assert sum(paid.values()) <= 50


class TestEmptyTable:
    def test_the_last_player_leaving_pauses_the_board(self, act, store):
        room_id = started_table(act, store, P1)

        act(P1, "leave-seat", roomId=room_id)

        r = room(store, room_id)
        assert r["phase"] == "playing"
        assert r["emptySince"] is not None
        assert act(HOST, "roll", roomId=room_id).status_code == 400

    def test_the_host_may_leave_a_paused_table_freely(self, act, store):
        room_id = started_table(act, store, P1)
        act(P1, "leave-seat", roomId=room_id)

        act(HOST, "tick", roomId=room_id, here=False)

        assert room(store, room_id)["hostLeaves"] == 0

    def test_a_friend_can_sit_at_a_paused_table_and_play_resumes(self, act, store):
        room_id = started_table(act, store, P1)
        act(P1, "leave-seat", roomId=room_id)

        seat(act, P2, room_id, "green")

        r = room(store, room_id)
        assert r["emptySince"] is None
        assert P2 in r["playerUids"]
        assert coins(store, P2) == 90

    def test_a_seat_cannot_be_taken_mid_game_otherwise(self, act, store):
        room_id = started_table(act, store, P1)

        response = act(P2, "buy-ticket", roomId=room_id, color="green", nickname="P2")

        assert response.status_code == 400

    def test_five_minutes_empty_ends_the_table(self, act, store):
        room_id = started_table(act, store, P1)
        act(P1, "leave-seat", roomId=room_id)
        room(store, room_id)["emptySince"] = now() - timedelta(minutes=6)

        act(HOST, "tick", roomId=room_id)

        r = room(store, room_id)
        assert r["status"] == "closed"
        assert r["phase"] == "finished"
        assert r["settlement"]["depositToApp"] == 50


class TestAdminSettings:
    def test_ludo_amounts_are_editable(self, client, store, monkeypatch):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (HOST, None))

        response = client.post("/api/v1/admin/settings", json={"settings": {"ludoWinnerPrize": 30}})

        assert response.status_code == 200
        assert store["settings/pricing"]["ludoWinnerPrize"] == 30

    def test_out_of_range_is_refused(self, client, store, monkeypatch):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (HOST, None))

        response = client.post("/api/v1/admin/settings", json={"settings": {"ludoHostSharePercent": 150}})

        assert response.status_code == 400

    def test_saved_settings_still_show_new_defaults(self, client, store, monkeypatch):
        monkeypatch.setattr(app_module, "require_admin_uid", lambda: (HOST, None))
        store["settings/pricing"] = {"voiceCallRatePerMin": 20}

        settings = client.get("/api/v1/admin/settings").get_json()["settings"]

        assert settings["ludoHostDeposit"] == 50
        assert settings["voiceCallRatePerMin"] == 20
