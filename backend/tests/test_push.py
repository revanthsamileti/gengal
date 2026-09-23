"""Push payloads, shaped the way the app's expo-notifications reads them.

The server sends Firebase Cloud Messaging data messages itself rather than
through Expo's push service. expo-notifications only displays such a message if
it carries the keys Expo's own service would have put there -- `title`,
`message`, a JSON `body` that becomes `content.data` in the app, and
`channelId` -- so those keys are pinned here. Getting one wrong fails silently
on a phone: the message arrives and nothing is shown.
"""

import json

import push


def test_data_carries_the_keys_expo_notifications_reads():
    out = push.expo_data("Asha", "hi there", {"type": "message", "chatId": "a_b"}, push.MESSAGE_CHANNEL)

    assert out["title"] == "Asha"
    assert out["message"] == "hi there"
    assert json.loads(out["body"]) == {"type": "message", "chatId": "a_b"}
    assert out["channelId"] == "messages"


def test_every_value_is_a_string():
    # FCM rejects a data map with any non-string value.
    out = push.expo_data("t", "m", {"n": 1, "ok": True, "none": None}, push.CALL_CHANNEL, tag="x")

    assert all(isinstance(v, str) for v in out.values())


def test_no_sound_key():
    # A `sound` value names a custom sound file bundled in the app; 'default'
    # is not one, and made Android create the call channel with no sound at
    # all. Leaving it out plays the channel's own sound.
    assert "sound" not in push.expo_data("t", "m", {}, push.CALL_CHANNEL)


def test_tag_replaces_the_previous_notification_for_the_same_thread():
    assert push.expo_data("t", "m", {}, push.MESSAGE_CHANNEL, tag="chat_a_b")["tag"] == "chat_a_b"
    assert "tag" not in push.expo_data("t", "m", {}, push.MESSAGE_CHANNEL)


def test_preview_is_trimmed():
    text = "x" * 500
    assert len(push.preview(text)) <= push.PREVIEW_CHARS
    assert push.preview(text).endswith("…")
    assert push.preview("  short  ") == "short"
    assert push.preview("") == "Sent you a message"
    assert push.preview(None) == "Sent you a message"


def test_chat_peer():
    assert push.chat_peer("aaa_bbb", "aaa") == "bbb"
    assert push.chat_peer("aaa_bbb", "bbb") == "aaa"
    # Not a participant, malformed, or a chat with yourself: no peer.
    assert push.chat_peer("aaa_bbb", "ccc") is None
    assert push.chat_peer("aaa", "aaa") is None
    assert push.chat_peer("aaa_bbb_ccc", "aaa") is None
    assert push.chat_peer("aaa_aaa", "aaa") is None
    assert push.chat_peer("", "aaa") is None


def test_call_channel_comes_from_the_phone():
    # A phone that reports the ringing channel gets it.
    assert push.call_channel_for({"callChannelId": "calls_v3"}) == "calls_v3"
    # Anything unknown, missing, or absent falls back to the channel every
    # install has — posting to a channel a phone lacks shows nothing at all.
    assert push.call_channel_for({"callChannelId": "calls_v9"}) == push.CALL_CHANNEL
    assert push.call_channel_for({}) == push.CALL_CHANNEL
    assert push.call_channel_for(None) == push.CALL_CHANNEL


def test_a_notification_is_swipeable_unless_asked_otherwise():
    assert "sticky" not in push.expo_data("Title", "Body", {}, "messages")


def test_sticky_is_sent_as_a_string_because_fcm_rejects_booleans():
    data = push.expo_data("Title", "Body", {}, "calls_v4", sticky=True)
    assert data["sticky"] == "true"
    assert all(isinstance(v, str) for v in data.values())


def test_the_ringing_channel_is_one_the_backend_will_post_to():
    assert push.call_channel_for({"callChannelId": "calls_v4"}) == "calls_v4"
