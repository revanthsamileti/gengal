import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, gradients } from '../theme/colors';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { popTone, pushTone, Tone } from '../theme/activeTone';

type ScreenShellProps = {
  children: React.ReactNode;
  tone?: Tone;
};


export default function ScreenShell({ children, tone = 'dark' }: ScreenShellProps) {
  // Publish the tone so root-level chrome — the alert dialog — can dress to
  // match the screen it is covering instead of always wearing the cream one.
  React.useEffect(() => {
    const id = pushTone(tone);
    return () => popTone(id);
  }, [tone]);


  if (tone === 'light') {
    return (
      <View style={[styles.root, styles.lightRoot]}>
        <LinearGradient colors={[...skeuoGradients.page]} style={StyleSheet.absoluteFill} />
        <View style={styles.lightGrainTop} />
        <View style={styles.lightGrainBottom} />
        <SafeAreaView style={styles.safe}>{children}</SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...gradients.page]} style={StyleSheet.absoluteFill} />
      {/* Ambient gold glow top-right */}
      <LinearGradient
        colors={['rgba(201,168,76,0.08)', 'transparent']}
        style={styles.ambientTop}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      {/* Ambient plum glow bottom-left */}
      <LinearGradient
        colors={['rgba(107,45,110,0.12)', 'transparent']}
        style={styles.ambientBottom}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
      />
      <SafeAreaView style={styles.safe}>{children}</SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { 
    flex: 1, 
    backgroundColor: colors.background,
    width: '100%',
    alignSelf: 'center',
    boxShadow: Platform.OS === 'web' ? '0px 0px 20px rgba(0,0,0,0.1)' : undefined,
  },
  lightRoot: { backgroundColor: skeuo.surface },
  safe: { flex: 1, paddingTop: Platform.OS === 'android' ? 8 : 0 },
  lightGrainTop: {
    position: 'absolute',
    top: -90,
    right: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255, 255, 255, 0.62)',
    boxShadow: Platform.OS === 'web' ? '0 18px 60px rgba(255, 255, 255, 0.65)' : undefined,
  },
  lightGrainBottom: {
    position: 'absolute',
    left: -80,
    bottom: 90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(203, 167, 47, 0.08)',
  },
  ambientTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  ambientBottom: {
    position: 'absolute',
    bottom: 80,
    left: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
  },
});
