import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import GengalAvatar from '../GengalAvatar';
import { numeric, RoomTone, roomPalette, roomRadius, ROOM_CHROME } from '../../theme/roomTheme';
import { tap38 } from '../../theme/touch';

/**
 * The shell every live room is built from: a header, an action dock, a utility
 * rail, and bottom sheets for chat and gifts.
 *
 * Each room screen used to grow its own version of these, which is how one
 * ended up with a chat panel competing with the stage for vertical space and
 * another with a gift modal nothing could open. Sizes here are fixed and match
 * ROOM_CHROME, so a screen can budget its stage against real numbers.
 */

// ── Header ───────────────────────────────────────────────────────────────────

export function RoomHeader({
  tone, eyebrow, title, onBack, watching, right,
}: {
  tone: RoomTone;
  eyebrow: string;
  title: string;
  onBack: () => void;
  watching?: number;
  right?: React.ReactNode;
}) {
  const c = roomPalette(tone);
  return (
    <View style={[s.header, { height: ROOM_CHROME.header }]}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Leave this room"
        hitSlop={tap38}
        style={({ pressed }) => [
          s.iconBtn,
          { backgroundColor: c.card, borderColor: c.line },
          pressed && s.pressed,
        ]}
      >
        <MaterialIcons name="arrow-back" size={20} color={c.ink} />
      </Pressable>

      <View style={s.headerMid}>
        <Text style={[s.eyebrow, { color: c.inkFaint }]} numberOfLines={1}>{eyebrow}</Text>
        <Text style={[s.headerTitle, { color: c.ink }]} numberOfLines={1}>{title}</Text>
      </View>

      {right}

      {watching !== undefined && (
        <View
          style={[s.watchers, { backgroundColor: c.card, borderColor: c.line }]}
          accessibilityLabel={`${watching} people here`}
        >
          <MaterialIcons name="people" size={13} color={c.accent} />
          <Text style={[s.watchersText, numeric, { color: c.accent }]}>{watching}</Text>
        </View>
      )}
    </View>
  );
}

// ── Action dock ──────────────────────────────────────────────────────────────

/**
 * States the room wants the user to read without hunting: what is happening,
 * what they can do about it, and what it is costing.
 */
export function RoomDock({
  tone, eyebrow, headline, hint, meter, action,
}: {
  tone: RoomTone;
  eyebrow: string;
  headline: string;
  hint?: string | null;
  /** Running spend, shown only when the room actually charges. */
  meter?: { spent: number; ratePerMin: number } | null;
  action?: React.ReactNode;
}) {
  const c = roomPalette(tone);
  return (
    <View
      style={[s.dock, {
        minHeight: ROOM_CHROME.dock,
        backgroundColor: c.card,
        borderColor: c.line,
      }]}
    >
      <View style={s.dockCopy}>
        <Text style={[s.eyebrow, { color: c.accent }]} numberOfLines={1}>{eyebrow}</Text>
        <Text style={[s.dockHeadline, { color: c.ink }]} numberOfLines={1}>{headline}</Text>
        {hint ? (
          <Text style={[s.dockHint, { color: c.inkSoft }]} numberOfLines={2}>{hint}</Text>
        ) : null}
        {meter ? (
          <Text
            style={[s.dockMeter, numeric, { color: c.inkFaint }]}
            accessibilityLabel={
              `You have spent ${Math.floor(meter.spent)} coins, at ${meter.ratePerMin} a minute`
            }
          >
            {Math.floor(meter.spent)} spent · {meter.ratePerMin}/min
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

// ── Utility rail ─────────────────────────────────────────────────────────────

export type RailItem = {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  badge?: number;
  active?: boolean;
  ionicon?: boolean;
  disabled?: boolean;
};

export function RoomRail({ tone, items }: { tone: RoomTone; items: RailItem[] }) {
  const c = roomPalette(tone);
  return (
    <View style={[s.rail, { height: ROOM_CHROME.rail }]}>
      {items.map((item) => {
        const Icon: any = item.ionicon ? Ionicons : MaterialIcons;
        return (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            disabled={item.disabled}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: item.active, disabled: item.disabled }}
            style={({ pressed }) => [
              s.railBtn,
              { backgroundColor: c.card, borderColor: item.active ? c.danger : c.line },
              item.disabled && s.railDisabled,
              pressed && s.pressed,
            ]}
          >
            <Icon name={item.icon} size={19} color={item.active ? c.danger : c.ink} />
            <Text style={[s.railLabel, { color: c.inkSoft }]} numberOfLines={1}>{item.label}</Text>
            {!!item.badge && item.badge > 0 && (
              <View style={[s.badge, { backgroundColor: c.danger }]}>
                <Text style={[s.badgeText, numeric]}>{item.badge > 9 ? '9+' : item.badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Sheet ────────────────────────────────────────────────────────────────────

export function RoomSheet({
  tone, title, onClose, bottomInset, children,
}: {
  tone: RoomTone;
  title: string;
  onClose: () => void;
  bottomInset: number;
  children: React.ReactNode;
}) {
  const c = roomPalette(tone);
  return (
    <View style={s.sheetRoot}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel={`Close ${title}`} />
      <View
        style={[s.sheet, {
          backgroundColor: c.bg,
          borderColor: c.lineStrong,
          paddingBottom: bottomInset + 12,
        }]}
      >
        <View style={[s.grip, { backgroundColor: c.line }]} />
        <Text style={[s.sheetTitle, { color: c.ink }]}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

// ── Chat feed ────────────────────────────────────────────────────────────────

export type FeedEntry = {
  id: string;
  kind: 'chat' | 'system';
  name?: string;
  text: string;
  mine?: boolean;
};

export function RoomChat({
  tone, entries, value, onChange, onSend, scrollRef,
}: {
  tone: RoomTone;
  entries: FeedEntry[];
  value: string;
  onChange: (t: string) => void;
  onSend: () => void;
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  const c = roomPalette(tone);
  return (
    <>
      <ScrollView
        ref={scrollRef as any}
        style={s.feed}
        onContentSizeChange={() => scrollRef?.current?.scrollToEnd({ animated: true })}
      >
        {entries.length === 0 ? (
          <Text style={[s.feedEmpty, { color: c.inkSoft }]}>No messages yet. Say hello.</Text>
        ) : (
          entries.map((e) => (
            <View key={e.id} style={s.feedRow}>
              {e.kind === 'chat' ? (
                <>
                  <Text style={[s.feedName, { color: e.mine ? c.accent : c.live }]}>
                    {e.mine ? 'You' : e.name}
                  </Text>
                  <Text style={[s.feedText, { color: c.ink }]}>{e.text}</Text>
                </>
              ) : (
                <Text style={[s.feedSystem, { color: c.inkFaint }]}>{e.text}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>

      <View style={s.composer}>
        <TextInput
          style={[s.input, { backgroundColor: c.cardSunk, borderColor: c.line, color: c.ink }]}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSend}
          placeholder="Message the room"
          placeholderTextColor={c.inkFaint}
          returnKeyType="send"
          accessibilityLabel="Message the room"
        />
        <Pressable
          onPress={onSend}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={({ pressed }) => [s.sendBtn, { backgroundColor: c.accent }, pressed && s.pressed]}
        >
          <MaterialIcons name="send" size={17} color={c.onAccent} />
        </Pressable>
      </View>
    </>
  );
}

// ── Gift picker ──────────────────────────────────────────────────────────────

export type GiftTarget = { uid: string; nickname: string; avatarData?: any };
export type GiftOption = { id: string; name: string; emoji: string; cost: number };

export function RoomGifts({
  tone, targets, selectedUid, onSelectTarget, gifts, onSend,
}: {
  tone: RoomTone;
  targets: GiftTarget[];
  selectedUid: string | null;
  onSelectTarget: (uid: string) => void;
  gifts: GiftOption[];
  onSend: (gift: GiftOption) => void;
}) {
  const c = roomPalette(tone);

  if (targets.length === 0) {
    return <Text style={[s.feedEmpty, { color: c.inkSoft }]}>Nobody else is here yet.</Text>;
  }

  // With a single recipient there is nothing to choose, so the chip is shown
  // as a plain label. It used to be a Pressable wired to a no-op handler, which
  // looked tappable and did nothing.
  const isChoice = targets.length > 1;

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.targets}>
        {targets.map((t) => {
          const chipStyle = [
            s.target,
            { backgroundColor: c.cardSunk, borderColor: selectedUid === t.uid ? c.accent : c.line },
          ];
          const chipBody = (
            <>
              <GengalAvatar data={t.avatarData} size={34} />
              <Text style={[s.targetName, { color: c.inkSoft }]} numberOfLines={1}>{t.nickname}</Text>
            </>
          );

          return isChoice ? (
            <Pressable
              key={t.uid}
              onPress={() => onSelectTarget(t.uid)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedUid === t.uid }}
              accessibilityLabel={`Send to ${t.nickname}`}
              style={chipStyle}
            >
              {chipBody}
            </Pressable>
          ) : (
            <View key={t.uid} style={chipStyle} accessibilityLabel={`Sending to ${t.nickname}`}>
              {chipBody}
            </View>
          );
        })}
      </ScrollView>

      <View style={s.gifts}>
        {gifts.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => onSend(g)}
            disabled={!selectedUid}
            accessibilityRole="button"
            accessibilityLabel={`${g.name}, ${g.cost} coins`}
            accessibilityState={{ disabled: !selectedUid }}
            style={({ pressed }) => [
              s.gift,
              { backgroundColor: c.cardSunk, borderColor: c.line },
              !selectedUid && s.railDisabled,
              pressed && s.pressed,
            ]}
          >
            <Text style={s.giftEmoji}>{g.emoji}</Text>
            <Text style={[s.giftName, { color: c.ink }]} numberOfLines={1}>{g.name}</Text>
            <Text style={[s.giftCost, numeric, { color: c.accent }]}>{g.cost}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.7 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  headerMid: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  headerTitle: { fontSize: 17, fontWeight: '900', marginTop: 1 },
  watchers: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: roomRadius.chip, borderWidth: 1,
  },
  watchersText: { fontSize: 11, fontWeight: '800' },

  dock: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 14, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: roomRadius.dock, borderWidth: 1,
  },
  dockCopy: { flex: 1, gap: 3, minWidth: 0 },
  dockHeadline: { fontSize: 19, fontWeight: '900' },
  dockHint: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  dockMeter: { fontSize: 11, fontWeight: '700', marginTop: 1 },

  rail: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  railBtn: {
    flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    gap: 2, borderWidth: 1,
  },
  railDisabled: { opacity: 0.45 },
  railLabel: { fontSize: 9, fontWeight: '800' },
  badge: {
    position: 'absolute', top: 4, right: 10,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,4,8,0.66)' },
  sheet: {
    borderTopLeftRadius: roomRadius.sheet, borderTopRightRadius: roomRadius.sheet,
    borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 10, gap: 12, maxHeight: '74%',
  },
  grip: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '900' },

  feed: { maxHeight: 260 },
  feedEmpty: { fontSize: 13, fontWeight: '600', paddingVertical: 22, textAlign: 'center' },
  feedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 7 },
  feedName: { fontSize: 13, fontWeight: '900' },
  feedText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  feedSystem: { fontSize: 12, fontWeight: '700', fontStyle: 'italic' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16, borderWidth: 1, fontSize: 14 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  targets: { gap: 10, paddingVertical: 2 },
  target: {
    width: 74, alignItems: 'center', gap: 5, padding: 8,
    borderRadius: 14, borderWidth: 1.5,
  },
  targetName: { fontSize: 10, fontWeight: '800' },
  gifts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gift: {
    width: 74, alignItems: 'center', gap: 3, paddingVertical: 12,
    borderRadius: 14, borderWidth: 1,
  },
  giftEmoji: { fontSize: 26 },
  giftName: { fontSize: 11, fontWeight: '800' },
  giftCost: { fontSize: 10, fontWeight: '800' },
});
