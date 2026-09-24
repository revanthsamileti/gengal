"""Push notifications to the GenGal app.

Sent as Firebase Cloud Messaging *data* messages straight from this server,
with the Firebase Admin credentials it already holds, instead of relaying
through Expo's push service. The relay needed a second copy of an FCM key
uploaded to Expo; sending directly needs nothing new.

expo-notifications in the app turns a data message into a visible notification
only when it carries the keys Expo's own service would have used:

    title, message   what the notification shows
    body             JSON; becomes `notification.request.content.data` in JS
    channelId        the Android channel (importance, sound, vibration)
    tag              optional; a newer message with the same tag replaces the
                     older one in the tray instead of stacking under it

Data-only, high-priority messages reach the app's messaging service even when
the app is in the background or was swiped away, so this is what lets a call
ring someone who is using another app.
"""

import json

# Must match CALL_CHANNEL_ID / MESSAGE_CHANNEL_ID in
# src/services/notificationService.ts. Android freezes a channel's settings
# once created, which is why the call channel carries a version suffix.
CALL_CHANNEL = "calls_v2"
MESSAGE_CHANNEL = "messages"

# Call channels a phone may report in user_private.callChannelId. Posting to a
# channel an install does not have shows nothing at all, so the id is taken
# from the device rather than assumed, and only known ones are honoured.
KNOWN_CALL_CHANNELS = (CALL_CHANNEL, "calls_v3", "calls_v4")


def call_channel_for(private_data):
    """The call channel this phone says it has, else the one every build has."""
    reported = (private_data or {}).get("callChannelId")
    return reported if reported in KNOWN_CALL_CHANNELS else CALL_CHANNEL

# How long FCM keeps trying to deliver. A call is dead after its 60 s offer
# window, and ringing it later only confuses; a message is still worth
# delivering to a phone that was off for the night.
CALL_TTL_SECONDS = 60
MESSAGE_TTL_SECONDS = 24 * 60 * 60

PREVIEW_CHARS = 120


class TokenGone(Exception):
    """The phone no longer answers to this token (app uninstalled, data cleared)."""


# Names the Answer / Decline buttons the app registered (CALL_CATEGORY_ID in
# src/services/notificationService.ts). An install without that category shows
# the notification with no buttons, which is the old behaviour.
CALL_CATEGORY = "incoming_call"


# The accent Android paints the app name and small icon with. GenGal's plum,
# matching PLUM in the app's screens.
BRAND_COLOR = "#5A155A"


def expo_data(title, message, data, channel_id, tag=None, category_id=None, sticky=False,
              color=BRAND_COLOR):
    """The FCM data map for a notification expo-notifications will display.

    Every value is a string, because FCM rejects anything else. There is no
    `sound` key on purpose: its value names a custom sound file bundled in the
    app, and 'default' is not one -- that mistake once created the call channel
    with no sound at all. Without the key the channel's own sound plays.

    `sticky` makes the notification unswipeable (Android setOngoing). It is for
    calls only: a call that is still ringing must not be flicked away by
    accident. Whatever sets it must also guarantee a way for the notification
    to leave the tray -- see /api/v1/calls/cancel-notify.
    """
    out = {
        "title": str(title),
        "message": str(message),
        "body": json.dumps(data),
        "channelId": channel_id,
    }
    if tag:
        out["tag"] = str(tag)
    if category_id:
        out["categoryId"] = str(category_id)
    if sticky:
        out["sticky"] = "true"
    if color:
        out["color"] = str(color)
    return out


def preview(text):
    """A message's text as the notification shows it: trimmed and bounded."""
    text = (text or "").strip()
    if not text:
        return "Sent you a message"
    if len(text) > PREVIEW_CHARS:
        return text[: PREVIEW_CHARS - 1].rstrip() + "…"
    return text


def chat_peer(chat_id, uid):
    """The other participant of a two-person chat, or None.

    A chat id is the two uids sorted and joined with '_' (getChatId in the
    app), and Firebase uids never contain '_'. Deriving the pair from the id
    means a client cannot name someone else's conversation to push into it.
    """
    parts = (chat_id or "").split("_")
    if len(parts) != 2 or uid not in parts or parts[0] == parts[1]:
        return None
    return parts[1] if parts[0] == uid else parts[0]
