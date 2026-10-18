import { Alert } from '../components/CustomAlert';
import React, { useState, useEffect } from 'react';
import {
  Platform, View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenShell from '../components/ScreenShell';
import {
  getAdminSettings,
  updateGlobalSettings,
  checkIsAdmin,
  GlobalSettings,
  hostBonus,
  HostBonusPlan,
  getReports,
  dismissReports,
  setBanned,
  ReportGroup,
  BannedAccount,
  listCoupons,
  createCoupon,
  setCouponActive,
  Coupon,
} from '../services/adminService';
import { useActionLock } from '../hooks/useActionLock';
import { tap40 } from '../theme/touch';

type Props = { navigate: (s: string, p?: any) => void; goBack?: () => void };

type FieldDef = {
  key: keyof GlobalSettings;
  label: string;
  hint: string;
  icon: string;
  suffix?: string;
  prefix?: string;
  /** Starts a new group with this heading. */
  section?: string;
};

const FIELDS: FieldDef[] = [
  { key: 'voiceCallRatePerMin', label: 'Voice Call Rate', hint: 'Coins per minute', icon: 'phone', suffix: 'coins/min' },
  { key: 'videoCallRatePerMin', label: 'Video Call Rate', hint: 'Coins per minute', icon: 'videocam', suffix: 'coins/min' },
  { key: 'callDurationForHeart', label: 'Minutes per Heart', hint: 'Minutes of calls to earn 1 heart', icon: 'favorite', suffix: 'min' },
  { key: 'heartToInrRate', label: 'Heart → INR Rate', hint: 'INR value per heart', icon: 'currency-rupee', prefix: '₹', suffix: '/heart' },
  { key: 'minRechargeAmount', label: 'Min Recharge', hint: 'Minimum recharge in INR', icon: 'account-balance-wallet', prefix: '₹' },
  { key: 'inrToCoinRechargeRate', label: 'INR → Coins Rate', hint: 'Coins per ₹1 recharged', icon: 'swap-horiz', suffix: 'coins/₹' },
  { key: 'creatorSharePercentage', label: 'Creator Share %', hint: 'Percentage of call cost sent to creator', icon: 'pie-chart', suffix: '%' },
  { key: 'minWithdrawalHearts', label: 'Min Withdrawal', hint: 'Hearts required before a payout can be requested', icon: 'savings', suffix: 'hearts' },
  { key: 'ludoHostDeposit', section: 'Ludo tables (new tables only)', label: 'Host deposit', hint: 'Paid to open a table. Kept by the app if the host stays to the end', icon: 'account-balance', suffix: 'coins' },
  { key: 'ludoRateThreePlayers', label: 'Rate, 3 players', hint: 'Each player pays per minute when 3 are playing', icon: 'timer', suffix: 'coins/min' },
  { key: 'ludoRateTwoPlayers', label: 'Rate, 2 players', hint: 'Each player pays per minute when 2 are playing', icon: 'timer', suffix: 'coins/min' },
  { key: 'ludoRateOnePlayer', label: 'Rate, 1 player', hint: 'The player pays per minute when playing alone with the host', icon: 'timer', suffix: 'coins/min' },
  { key: 'ludoHostSharePercent', label: 'Host share', hint: 'Part of every per-minute payment that goes to the host', icon: 'pie-chart', suffix: '%' },
  { key: 'ludoForfeitThreePlayers', label: 'Deposit split, 3 left', hint: 'Each player gets this if the host broke a limit; the rest goes to the app', icon: 'call-split', suffix: 'coins each' },
  { key: 'ludoForfeitTwoPlayers', label: 'Deposit split, 2 left', hint: 'Each player gets this if the host broke a limit', icon: 'call-split', suffix: 'coins each' },
  { key: 'ludoForfeitOnePlayer', label: 'Deposit split, 1 left', hint: 'The player gets this if the host broke a limit', icon: 'call-split', suffix: 'coins' },
  { key: 'ludoWinnerPrize', label: 'Winner bonus', hint: 'Paid by the app to whoever finishes first', icon: 'emoji-events', suffix: 'coins' },
  { key: 'ludoHostMaxLeaves', label: 'Host comebacks', hint: 'Times the host may leave and return before their turns are skipped', icon: 'logout', suffix: 'times' },
  { key: 'ludoHostMaxMissedTurns', label: 'Host missed turns', hint: 'Turns the host may let run out before their turns are skipped', icon: 'timer-off', suffix: 'turns' },
  { key: 'ludoEmptyCloseMinutes', label: 'Empty table closes after', hint: 'An empty, paused table ends after this long', icon: 'hourglass-empty', suffix: 'min' },
  { key: 'ludoWatchAppPerMinute', label: 'Watcher fee, app part', hint: 'Most a watcher pays the app in a minute of play', icon: 'visibility', suffix: 'coins/min' },
  { key: 'ludoWatchAppStepSeconds', label: 'App part, 1 coin every', hint: 'Taken per started step until the app part for the minute is reached', icon: 'av-timer', suffix: 'sec' },
  { key: 'ludoWatchHostPerMinute', label: 'Watcher fee, host part', hint: 'Most a watcher pays the host in a minute of play', icon: 'visibility', suffix: 'coins/min' },
  { key: 'ludoWatchHostStepSeconds', label: 'Host part, 1 coin every', hint: 'Taken per started step until the host part for the minute is reached', icon: 'av-timer', suffix: 'sec' },
  { key: 'coinDiscountPercent', section: 'Offers', label: 'Store discount', hint: 'Every pack costs this much less for the same coins. Up to 50%', icon: 'local-offer', suffix: '%' },
  { key: 'firstBuyPriceInr', label: 'First recharge price', hint: 'One pack for an account that has never recharged. 0 turns it off', icon: 'redeem', prefix: '₹' },
  { key: 'firstBuyCoins', label: 'First recharge coins', hint: 'Coins that pack gives', icon: 'redeem', suffix: 'coins' },
  { key: 'dailyBonusCoins', label: 'Daily bonus', hint: 'Free coins, claimable once a day. 0 turns it off', icon: 'card-giftcard', suffix: 'coins' },
  { key: 'dailyBonusMinVoiceMinutes', label: 'Daily bonus unlocks after', hint: 'Paid voice-call minutes that day', icon: 'phone-in-talk', suffix: 'min' },
  { key: 'hostBonusMinMinutes', section: 'Host daily bonus', label: 'Hosts qualify after', hint: 'Paid talk time that day', icon: 'timer', suffix: 'min' },
  { key: 'hostBonusTopCount', label: 'Winners', hint: 'Top hosts by talk time who share the pool', icon: 'emoji-events', suffix: 'hosts' },
  { key: 'hostBonusPoolPercent', label: 'Pool', hint: "Share of the day's call revenue, paid as hearts. Up to 50%", icon: 'savings', suffix: '%' },
];

export default function AdminPanelScreen({ navigate, goBack }: Props) {
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The backend already rejects non-admin writes, but the screen used to render
  // the full pricing form to anyone who reached it. `navigate('AdminPanel')` is
  // callable from anywhere, so the gate belongs here too.
  const [access, setAccess] = useState<'checking' | 'granted' | 'denied'>('checking');
  const { locked: confirming, run: runSave } = useActionLock();

  useEffect(() => {
    let active = true;
    checkIsAdmin()
      .then((ok) => { if (active) setAccess(ok ? 'granted' : 'denied'); })
      .catch(() => { if (active) setAccess('denied'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (access !== 'granted') return;
    // Always resolves: previously an unhandled rejection here left the screen
    // stuck on the loading spinner forever.
    getAdminSettings()
      .then((s) => {
        const vals: Record<string, string> = {};
        FIELDS.forEach(f => { vals[f.key] = String((s as any)[f.key] ?? ''); });
        setEditValues(vals);
      })
      .catch((e: any) => {
        setLoadError(e?.message || 'Could not load settings.');
      })
      .finally(() => setLoading(false));
  }, [access]);

  const collectUpdates = () => {
    const updates: Partial<GlobalSettings> = {};
    FIELDS.forEach(f => {
      const val = parseFloat(editValues[f.key]);
      if (!isNaN(val)) (updates as any)[f.key] = val;
    });
    return updates;
  };

  const applyUpdates = async (updates: Partial<GlobalSettings>) => {
    setSaving(true);
    try {
      await updateGlobalSettings(updates);
      Alert.alert('Deployed', 'Global settings updated successfully.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * These rates apply to every user immediately and there is no undo, so the
   * change is spelled out field by field before it goes live.
   */
  const handleSave = () =>
    runSave(() => {
      const updates = collectUpdates();
      const changed = FIELDS
        .filter(f => (updates as any)[f.key] !== undefined)
        .map(f => `• ${f.label}: ${f.prefix ?? ''}${(updates as any)[f.key]}${f.suffix ? ' ' + f.suffix : ''}`);

      if (changed.length === 0) {
        Alert.alert('Nothing to deploy', 'No valid values to save.', [{ text: 'OK' }]);
        return;
      }

      Alert.alert(
        'Deploy to all users?',
        `This changes pricing for everyone immediately and cannot be undone.\n\n${changed.join('\n')}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Deploy', style: 'destructive', onPress: () => { void applyUpdates(updates); } },
        ]
      );
    });

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <LinearGradient colors={['#1A0020', '#3B0044']} style={styles.header}>
          <TouchableOpacity style={styles.backBtn} hitSlop={tap40} onPress={() => goBack ? goBack() : navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={22} color="#FFFDF8" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <MaterialIcons name="admin-panel-settings" size={20} color="#D49A0B" />
            <Text style={styles.headerTitle}>Admin Panel</Text>
          </View>
          <View style={{ width: 40 }} />
        </LinearGradient>

        {access === 'checking' ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color="#4B0054" />
            <Text style={styles.loaderText}>Verifying access…</Text>
          </View>
        ) : access === 'denied' ? (
          <View style={styles.loader}>
            <MaterialIcons name="lock" size={32} color="#B45309" />
            <Text style={styles.loaderText}>
              This area is restricted to administrators.
            </Text>
          </View>
        ) : loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color="#4B0054" />
            <Text style={styles.loaderText}>Loading settings…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.loader}>
            <MaterialIcons name="lock" size={32} color="#B45309" />
            <Text style={styles.loaderText}>{loadError}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.warningCard}>
              <MaterialIcons name="warning" size={16} color="#D97706" />
              <Text style={styles.warningText}>
                Changes apply globally to all users immediately.
              </Text>
            </View>

            {FIELDS.map((field) => (
              <React.Fragment key={field.key}>
              {field.section ? <Text style={styles.sectionHeading}>{field.section}</Text> : null}
              <View style={styles.fieldCard}>
                <View style={styles.fieldHeader}>
                  <View style={styles.fieldIconBox}>
                    <MaterialIcons name={field.icon as any} size={18} color="#4B0054" />
                  </View>
                  <View style={styles.fieldMeta}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldHint}>{field.hint}</Text>
                  </View>
                </View>
                <View style={styles.inputRow}>
                  {field.prefix && <Text style={styles.inputAddon}>{field.prefix}</Text>}
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={editValues[field.key] ?? ''}
                    onChangeText={(v) => setEditValues(prev => ({ ...prev, [field.key]: v }))}
                    placeholder="0"
                    placeholderTextColor="#BBA0A0"
                  />
                  {field.suffix && <Text style={styles.inputAddon}>{field.suffix}</Text>}
                </View>
              </View>
              </React.Fragment>
            ))}

            <TouchableOpacity
              style={styles.saveBtn}
              activeOpacity={0.85}
              onPress={handleSave}
              disabled={saving || confirming}
              accessibilityRole="button"
              accessibilityLabel="Deploy pricing changes to all users"
              accessibilityState={{ disabled: saving || confirming }}
            >
              <LinearGradient colors={['#4B0054', '#7B0085']} style={styles.saveBtnInner}>
                {saving
                  ? <ActivityIndicator color="#FFF" />
                  : <>
                    <MaterialIcons name="cloud-upload" size={18} color="#FFFDF8" />
                    <Text style={styles.saveBtnText}>Deploy Changes</Text>
                  </>}
              </LinearGradient>
            </TouchableOpacity>

            <HostBonusPanel />

            <ReportsPanel />

            <CouponsPanel />
          </ScrollView>
        )}
      </View>
    </ScreenShell>
  );
}

/**
 * Coupon codes: make one (blank code = made up), see how many have used
 * each, switch one off or back on.
 */
function CouponsPanel() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [code, setCode] = useState('');
  const [coins, setCoins] = useState('100');
  const [maxUses, setMaxUses] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => { listCoupons().then((r) => setCoupons(r.coupons)).catch(() => setCoupons([])); };
  useEffect(load, []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const made = await createCoupon({
        code: code.trim() || undefined,
        coins: Number(coins) || 0,
        maxUses: Number(maxUses) || 0,
        days: Number(days) || 0,
      });
      setCode('');
      Alert.alert('Coupon made', `Share the code ${made.code}.`);
      load();
    } catch (e: any) {
      Alert.alert('Coupon', e?.message || 'Could not make that coupon.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: Coupon) => {
    try {
      await setCouponActive(c.code, !c.active);
      load();
    } catch (e: any) {
      Alert.alert('Coupon', e?.message || 'Could not change that coupon.');
    }
  };

  return (
    <View>
      <Text style={styles.sectionHeading}>Coupons</Text>
      <View style={styles.fieldCard}>
        <Text style={styles.fieldHint}>Code (empty = make one up)</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
            placeholder="GRAB100"
            placeholderTextColor="#BBA0A0"
            autoCapitalize="characters"
          />
        </View>
        <View style={styles.couponRow}>
          {([
            ['Coins', coins, setCoins, '100'],
            ['Max uses', maxUses, setMaxUses, 'No limit'],
            ['Days', days, setDays, 'Forever'],
          ] as const).map(([label, val, set, ph]) => (
            <View key={label} style={{ flex: 1 }}>
              <Text style={styles.fieldHint}>{label}</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.input, { fontSize: 15 }]}
                  value={val}
                  onChangeText={set}
                  keyboardType="number-pad"
                  placeholder={ph}
                  placeholderTextColor="#BBA0A0"
                />
              </View>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[styles.bonusBtn, styles.bonusBtnPay, { marginTop: 12 }]} onPress={() => { void create(); }} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#FFFDF8" /> : <Text style={[styles.bonusBtnText, { color: '#FFFDF8' }]}>Make coupon</Text>}
        </TouchableOpacity>
      </View>

      {(coupons ?? []).map((c) => (
        <View key={c.code} style={[styles.fieldCard, styles.reportTitleRow]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel} selectable>{c.code} · {c.coins} coins</Text>
            <Text style={styles.fieldHint}>
              Used {c.uses}{c.maxUses ? ` of ${c.maxUses}` : ''}
              {c.expiresAt ? ` · ends ${shortDate(c.expiresAt)}` : ''}
              {c.active ? '' : ' · OFF'}
            </Text>
          </View>
          <TouchableOpacity style={[styles.bonusBtn, { flex: 0, paddingHorizontal: 14 }]} onPress={() => { void toggle(c); }} accessibilityRole="button">
            <Text style={styles.bonusBtnText}>{c.active ? 'Switch off' : 'Switch on'}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

/** Short date for a report, or '' when there is none. */
function shortDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Reports, grouped by who was reported, most-reported first. Dismiss closes
 * them; Ban signs that person out for good, hides them everywhere and closes
 * the reports. Banned accounts are listed underneath with Unban.
 */
function ReportsPanel() {
  const [groups, setGroups] = useState<ReportGroup[] | null>(null);
  const [banned, setBannedList] = useState<BannedAccount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = async () => {
    setFailed(null);
    try {
      const result = await getReports();
      setGroups(result.groups);
      setBannedList(result.banned);
    } catch (e: any) {
      setFailed(e?.message || 'Could not load reports.');
    }
  };
  useEffect(() => { void load(); }, []);

  const act = async (uid: string, work: () => Promise<unknown>) => {
    setBusy(uid);
    try {
      await work();
      await load();
    } catch (e: any) {
      Alert.alert('Reports', e?.message || 'Could not do that.');
    } finally {
      setBusy(null);
    }
  };

  const confirmBan = (g: ReportGroup) => {
    const top = Object.entries(g.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Reported';
    Alert.alert(
      `Ban ${g.nickname}?`,
      `They are signed out, cannot sign back in, and disappear from every list. Their ${g.count} report(s) are closed. You can unban them later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Ban', style: 'destructive', onPress: () => { void act(g.targetUid, () => setBanned(g.targetUid, true, top)); } },
      ],
    );
  };

  return (
    <View>
      <View style={styles.reportsHead}>
        <Text style={styles.sectionHeading}>Reports{groups ? ` (${groups.reduce((n, g) => n + g.count, 0)} open)` : ''}</Text>
        <TouchableOpacity onPress={() => { void load(); }} hitSlop={tap40} accessibilityRole="button" accessibilityLabel="Refresh reports">
          <MaterialIcons name="refresh" size={20} color="#4B0054" />
        </TouchableOpacity>
      </View>

      {failed ? (
        <Text style={styles.fieldHint}>{failed}</Text>
      ) : groups === null ? (
        <ActivityIndicator color="#4B0054" style={{ marginVertical: 12 }} />
      ) : groups.length === 0 ? (
        <View style={styles.fieldCard}><Text style={styles.fieldHint}>No open reports.</Text></View>
      ) : groups.map((g) => (
        <View key={g.targetUid} style={styles.fieldCard}>
          <View style={styles.reportTitleRow}>
            <Text style={styles.fieldLabel} numberOfLines={1}>{g.nickname}</Text>
            <Text style={styles.reportCount}>{g.count} report{g.count === 1 ? '' : 's'}</Text>
          </View>
          <Text style={styles.fieldHint}>
            {Object.entries(g.reasons).map(([reason, n]) => (n > 1 ? `${reason} ×${n}` : reason)).join(' · ')}
          </Text>
          {g.reports.slice(0, 3).map((r) => (
            <Text key={r.id} style={styles.reportLine}>
              {r.reporter} · {r.reason} · from {r.source} · {shortDate(r.createdAt)}
            </Text>
          ))}
          <View style={styles.bonusButtons}>
            <TouchableOpacity
              style={styles.bonusBtn}
              disabled={!!busy}
              onPress={() => { void act(g.targetUid, () => dismissReports(g.targetUid)); }}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss reports about ${g.nickname}`}
            >
              {busy === g.targetUid ? <ActivityIndicator color="#4B0054" /> : <Text style={styles.bonusBtnText}>Dismiss</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bonusBtn, styles.banBtn]}
              disabled={!!busy || g.banned}
              onPress={() => confirmBan(g)}
              accessibilityRole="button"
              accessibilityLabel={`Ban ${g.nickname}`}
            >
              <Text style={[styles.bonusBtnText, { color: '#FFFDF8' }]}>{g.banned ? 'Banned' : 'Ban'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {banned.length > 0 && (
        <>
          <Text style={styles.sectionHeading}>Banned accounts</Text>
          {banned.map((b) => (
            <View key={b.uid} style={[styles.fieldCard, styles.reportTitleRow]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel} numberOfLines={1}>{b.nickname}</Text>
                <Text style={styles.fieldHint}>{b.reason}{b.bannedAt ? ` · ${shortDate(b.bannedAt)}` : ''}</Text>
              </View>
              <TouchableOpacity
                style={[styles.bonusBtn, { flex: 0, paddingHorizontal: 16 }]}
                disabled={!!busy}
                onPress={() => { void act(b.uid, () => setBanned(b.uid, false)); }}
                accessibilityRole="button"
                accessibilityLabel={`Unban ${b.nickname}`}
              >
                {busy === b.uid ? <ActivityIndicator color="#4B0054" /> : <Text style={styles.bonusBtnText}>Unban</Text>}
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** A day in India time, YYYY-MM-DD, `offset` days from today. */
function istDay(offset = 0) {
  return new Date(Date.now() + 5.5 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Preview, then pay, one day's host bonus. The pool is the settings' share of
 * that day's call revenue unless an amount is typed here. Pay is offered only
 * for exactly what was last previewed, and the server pays a day once.
 */
function HostBonusPanel() {
  const [day, setDay] = useState(istDay(-1));
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<HostBonusPlan | null>(null);
  const [previewedFor, setPreviewedFor] = useState('');
  const [busy, setBusy] = useState<null | 'preview' | 'pay'>(null);

  const key = `${day.trim()}|${amount.trim()}`;
  const amountValue = amount.trim() === '' ? undefined : Number(amount);

  const run = async (action: 'preview' | 'pay') => {
    if (amountValue !== undefined && (isNaN(amountValue) || amountValue < 0)) {
      Alert.alert('Amount', 'Enter an amount in rupees, or leave it empty to use the pool %.');
      return;
    }
    setBusy(action);
    try {
      const result = await hostBonus(action, day.trim(), amountValue);
      setPlan(result);
      setPreviewedFor(key);
      if (action === 'pay') {
        Alert.alert('Paid', `₹${result.poolInr} was added as hearts to ${result.winners.length} host(s) for ${result.day}.`);
      }
    } catch (e: any) {
      Alert.alert('Host bonus', e?.message || 'Could not do that.');
    } finally {
      setBusy(null);
    }
  };

  const canPay = !!plan && !plan.paid && previewedFor === key && plan.winners.length > 0 && day.trim() < istDay(0);
  const confirmPay = () => {
    if (!plan || !canPay) return;
    Alert.alert(
      'Pay the host bonus?',
      `₹${plan.poolInr} as hearts to ${plan.winners.length} host(s) for ${plan.day}. A day is paid once and this cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pay', style: 'destructive', onPress: () => { void run('pay'); } },
      ],
    );
  };

  return (
    <View>
      <Text style={styles.sectionHeading}>Pay host bonus</Text>
      <View style={styles.fieldCard}>
        <Text style={styles.fieldHint}>Day (India time)</Text>
        <View style={styles.inputRow}>
          <TextInput style={styles.input} value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" placeholderTextColor="#BBA0A0" autoCapitalize="none" />
        </View>
        <Text style={[styles.fieldHint, { marginTop: 10 }]}>Pool amount (empty = the Pool % above)</Text>
        <View style={styles.inputRow}>
          <Text style={styles.inputAddon}>₹</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Pool %" placeholderTextColor="#BBA0A0" />
        </View>
        <View style={styles.bonusButtons}>
          <TouchableOpacity style={styles.bonusBtn} onPress={() => { void run('preview'); }} disabled={!!busy} accessibilityRole="button">
            {busy === 'preview' ? <ActivityIndicator color="#4B0054" /> : <Text style={styles.bonusBtnText}>Preview</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bonusBtn, styles.bonusBtnPay, !canPay && { opacity: 0.4 }]}
            onPress={confirmPay}
            disabled={!canPay || !!busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPay }}
          >
            {busy === 'pay' ? <ActivityIndicator color="#FFFDF8" /> : <Text style={[styles.bonusBtnText, { color: '#FFFDF8' }]}>Pay</Text>}
          </TouchableOpacity>
        </View>

        {plan && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.bonusSummary}>
              {plan.day}: call revenue ₹{plan.revenueInr} · pool ₹{plan.poolInr}
              {plan.fixedAmount ? ' (your amount)' : ` (${plan.poolPercent}%)`}
              {plan.paid ? ' · PAID' : ''}
            </Text>
            {plan.winners.length === 0 ? (
              <Text style={styles.fieldHint}>No host talked long enough that day.</Text>
            ) : plan.winners.map((w) => (
              <View key={w.uid} style={styles.bonusRow}>
                <Text style={styles.bonusRank}>#{w.rank}</Text>
                <Text style={styles.bonusName} numberOfLines={1}>{w.nickname}</Text>
                <Text style={styles.bonusFigure}>{w.minutes} min</Text>
                <Text style={styles.bonusFigure}>₹{w.inr} · {w.hearts}♥</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#FFFDF8' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { color: '#8A7C70', fontSize: 14, fontWeight: '600' },

  scroll: { padding: 16, paddingBottom: 60 },

  warningCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFBEB', borderRadius: 12, padding: 12, marginBottom: 18,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  warningText: { flex: 1, fontSize: 12, color: '#92400E', fontWeight: '600', lineHeight: 17 },

  sectionHeading: {
    color: '#4B0054', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 2, marginHorizontal: 2,
  },
  fieldCard: {
    backgroundColor: '#FFFDF8', borderRadius: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#EEE4D8',
    boxShadow: Platform.OS === 'web' ? '0 1px 4px rgba(68,44,21,0.05)' : undefined,
  },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  fieldIconBox: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center',
  },
  fieldMeta: { flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: '800', color: '#4B0054' },
  fieldHint: { fontSize: 11, color: '#9A8772', fontWeight: '600', marginTop: 1 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F5EF', borderRadius: 10, borderWidth: 1, borderColor: '#EEE4D8',
    paddingHorizontal: 12, height: 46,
  },
  inputAddon: { fontSize: 13, fontWeight: '700', color: '#7A6800', marginHorizontal: 4 },
  input: { flex: 1, fontSize: 18, fontWeight: '800', color: '#4B0054' },

  saveBtn: {
    marginTop: 8, borderRadius: 16, overflow: 'hidden',
    boxShadow: Platform.OS === 'web' ? '0 8px 20px rgba(75,0,84,0.28)' : undefined,
  },
  saveBtnInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  saveBtnText: { color: '#FFFDF8', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  bonusButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  bonusBtn: {
    flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#4B0054',
  },
  bonusBtnPay: { backgroundColor: '#4B0054' },
  bonusBtnText: { color: '#4B0054', fontSize: 14, fontWeight: '900' },
  bonusSummary: { color: '#4B0054', fontSize: 13, fontWeight: '800', marginBottom: 8 },
  bonusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  bonusRank: { width: 30, color: '#9A8772', fontSize: 12, fontWeight: '800' },
  bonusName: { flex: 1, color: '#4B0054', fontSize: 13, fontWeight: '800' },
  bonusFigure: { color: '#7A6800', fontSize: 12, fontWeight: '700' },
  reportsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  reportTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  reportCount: { color: '#B3261E', fontSize: 12, fontWeight: '900' },
  reportLine: { color: '#6E5F52', fontSize: 11, fontWeight: '600', marginTop: 4 },
  couponRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  banBtn: { backgroundColor: '#B3261E', borderColor: '#B3261E' },
});
