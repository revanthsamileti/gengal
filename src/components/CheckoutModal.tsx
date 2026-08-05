import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { RazorpayResult } from '../services/coinService';
import { skeuo } from '../theme/skeuomorphic';

type Props = {
  /** Checkout page to load, from `createCoinOrder`. Null closes the sheet. */
  url: string | null;
  onSuccess: (result: RazorpayResult) => void;
  onCancel: () => void;
  onFailure: (message: string) => void;
};

/**
 * Runs Razorpay checkout inside a WebView.
 *
 * The page is served by our backend and loads Razorpay's own script, so card
 * and UPI details never touch this code and no payments SDK has to be bundled
 * (which would mean a new native build). All that comes back across
 * postMessage is a set of ids; they are worth nothing until the server
 * verifies them, so a tampered page cannot mint coins.
 */
export default function CheckoutModal({ url, onSuccess, onCancel, onFailure }: Props) {
  const [isLoading, setIsLoading] = useState(true);

  const handleMessage = (event: WebViewMessageEvent) => {
    let payload: any;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return; // Not one of ours; the checkout script chatters on this channel.
    }
    if (payload?.type === 'success') {
      onSuccess({
        razorpay_order_id: payload.razorpay_order_id,
        razorpay_payment_id: payload.razorpay_payment_id,
        razorpay_signature: payload.razorpay_signature,
      });
    } else if (payload?.type === 'failed') {
      onFailure(payload.message || 'Payment failed');
    } else if (payload?.type === 'dismissed') {
      onCancel();
    }
  };

  return (
    <Modal visible={!!url} animationType="slide" onRequestClose={onCancel} transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable
            style={styles.close}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel payment"
          >
            <MaterialIcons name="close" size={24} color={skeuo.creamTop} />
          </Pressable>
          <Text style={styles.title}>Secure Checkout</Text>
          <View style={{ width: 44 }} />
        </View>

        {url ? (
          <WebView
            source={{ uri: url }}
            onMessage={handleMessage}
            onLoadEnd={() => setIsLoading(false)}
            onError={() => onFailure('The checkout page could not be loaded.')}
            javaScriptEnabled
            domStorageEnabled
            style={styles.web}
          />
        ) : null}

        {isLoading ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator size="large" color={skeuo.gold} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: skeuo.plum },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: skeuo.creamTop, fontSize: 17, fontWeight: '700' },
  web: { flex: 1, backgroundColor: skeuo.plum },
  loading: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
