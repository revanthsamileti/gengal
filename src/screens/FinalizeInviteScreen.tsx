import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  StatusBar,
  Pressable,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, getDocs, query, where } from 'firebase/firestore';
import DiamondBadge from '../components/DiamondBadge';
import GengalAvatar, { AvatarData, DEFAULT_AVATAR_DNA } from '../components/GengalAvatar';
import { auth, db } from '../config/firebase';
import { getUserProfile, saveUserProfile } from '../services/userService';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';

type FinalizeInviteScreenProps = {
  navigation?: any;
  navigate?: (screen: string, params?: any) => void;
};

type BuilderCategory = 'hair' | 'face' | 'style' | 'accessory';

const HAIR_MEN: Partial<AvatarData>[] = [
  { topType: 'shortWaved' },
  { topType: 'shortCurly' },
  { topType: 'shortFlat' },
  { topType: 'shortRound' },
  { topType: 'sides' },
  { topType: 'dreads01' },
  { topType: 'dreads02' },
  { topType: 'frizzle' },
  { topType: 'shaggy' },
  { topType: 'shaggyMullet' },
  { topType: 'shavedHead' },
];
const HAIR_WOMEN: Partial<AvatarData>[] = [
  { topType: 'longButNotTooLong' },
  { topType: 'straight02' },
  { topType: 'curly' },
  { topType: 'bun' },
  { topType: 'straightAndStrand' },
  { topType: 'straight01' },
  { topType: 'bigHair' },
  { topType: 'bob' },
  { topType: 'curvy' },
  { topType: 'dreads' },
  { topType: 'frida' },
  { topType: 'fro' },
  { topType: 'froBand' },
  { topType: 'miaWallace' },
];

const FACE_MEN: Partial<AvatarData>[] = [
  { facialHairType: 'beardMedium', mouthType: 'serious', eyebrowType: 'default', eyeType: 'default' },
  { facialHairType: 'beardLight', mouthType: 'smile', eyebrowType: 'raisedExcited', eyeType: 'happy' },
  { facialHairType: 'beardMajestic', mouthType: 'twinkle', eyebrowType: 'defaultNatural', eyeType: 'wink' },
  { facialHairType: 'moustaceFancy', mouthType: 'smile', eyebrowType: 'default', eyeType: 'side' },
  { facialHairType: 'moustacheMagnum', mouthType: 'serious', eyebrowType: 'flatNatural', eyeType: 'squint' },
  { facialHairType: 'none', mouthType: 'smirk', eyebrowType: 'upDown', eyeType: 'winkWacky' },
  { facialHairType: 'beardLight', mouthType: 'grimace', eyebrowType: 'angry', eyeType: 'eyeRoll' },
  { facialHairType: 'none', mouthType: 'eating', eyebrowType: 'default', eyeType: 'surprised' },
  { facialHairType: 'beardMedium', mouthType: 'sad', eyebrowType: 'sadConcerned', eyeType: 'cry' },
];
const FACE_WOMEN: Partial<AvatarData>[] = [
  { facialHairType: 'none', mouthType: 'smile', eyeType: 'happy', eyebrowType: 'defaultNatural' },
  { facialHairType: 'none', mouthType: 'twinkle', eyeType: 'wink', eyebrowType: 'raisedExcited' },
  { facialHairType: 'none', mouthType: 'eating', eyeType: 'squint', eyebrowType: 'default' },
  { facialHairType: 'none', mouthType: 'tongue', eyeType: 'surprised', eyebrowType: 'raisedExcitedNatural' },
  { facialHairType: 'none', mouthType: 'serious', eyeType: 'default', eyebrowType: 'flatNatural' },
  { facialHairType: 'none', mouthType: 'smirk', eyeType: 'side', eyebrowType: 'upDownNatural' },
  { facialHairType: 'none', mouthType: 'screamOpen', eyeType: 'dizzy', eyebrowType: 'angryNatural' },
  { facialHairType: 'none', mouthType: 'disbelief', eyeType: 'eyeRoll', eyebrowType: 'frownNatural' },
  { facialHairType: 'none', mouthType: 'default', eyeType: 'hearts', eyebrowType: 'defaultNatural' },
];

const CLOTHING_MEN: Partial<AvatarData>[] = [
  { clotheType: 'blazerAndShirt' },
  { clotheType: 'shirtCrewNeck' },
  { clotheType: 'shirtVNeck' },
  { clotheType: 'shirtScoopNeck' },
  { clotheType: 'hoodie' },
  { clotheType: 'overall' },
];
const CLOTHING_WOMEN: Partial<AvatarData>[] = [
  { clotheType: 'blazerAndSweater' },
  { clotheType: 'shirtScoopNeck' },
  { clotheType: 'shirtVNeck' },
  { clotheType: 'shirtCrewNeck' },
  { clotheType: 'hoodie' },
  { clotheType: 'overall' },
];

const EXTRAS_EYEWEAR: Partial<AvatarData>[] = [
  { accessoriesType: 'none' },
  { accessoriesType: 'sunglasses' },
  { accessoriesType: 'prescription01' },
  { accessoriesType: 'prescription02' },
  { accessoriesType: 'round' },
  { accessoriesType: 'wayfarers' },
  { accessoriesType: 'kurt' },
  { accessoriesType: 'eyepatch' },
];

const HEADWEAR_MEN: Partial<AvatarData>[] = [
  { topType: 'hat' },
  { topType: 'turban' },
  { topType: 'winterHat1' },
];

const HEADWEAR_WOMEN: Partial<AvatarData>[] = [
  { topType: 'hat' },
  { topType: 'hijab' },
  { topType: 'winterHat1' },
];

const SKIN_OPTIONS = ['light', 'tanned', 'brown', 'dark', 'black'];
const HAIR_COLOR_OPTIONS = ['black', 'brownDark', 'blonde', 'red', 'silverGray'];
const CLOTHING_COLOR_OPTIONS = ['black', 'gray01', 'blue02', 'pastelBlue', 'pastelGreen', 'pastelRed', 'pink'];
const BG_COLOR_OPTIONS = ['#E2E8F0', '#FFD1DC', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#E6B3FF', '#FFE4E1'];

const getSkinHex = (color: string) => {
  const map: any = { light: '#edb98a', tanned: '#d08b5b', brown: '#ae5d29', dark: '#614335', black: '#2d1e16' };
  return map[color] || '#edb98a';
};
const getHairHex = (color: string) => {
  const map: any = { black: '#2c1b18', brownDark: '#4a3123', blonde: '#d6b370', red: '#ca4420', silverGray: '#e8e8e8' };
  return map[color] || '#2c1b18';
};
const getClothingHex = (color: string) => {
  const map: any = { black: '#262e33', gray01: '#e6e6e6', blue02: '#3c4f5c', pastelBlue: '#b1e2ff', pastelGreen: '#a7ffc4', pastelRed: '#ffafb9', pink: '#ff488e' };
  return map[color] || '#262e33';
};

const CATEGORY_LABELS: Record<BuilderCategory, string> = {
  hair: 'Hair',
  face: 'Face',
  style: 'Clothing',
  accessory: 'Accessories',
};

function BuilderTab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.builderTab} activeOpacity={0.82} onPress={onPress}>
      <MaterialIcons name={icon} size={25} color={active ? skeuo.plum : '#9A8772'} />
      <Text style={[styles.builderTabLabel, active && styles.builderTabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AvatarOption({
  data,
  selected,
  onPress,
}: {
  data: AvatarData;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.avatarOption, selected && styles.avatarOptionActive]} onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.avatarOptionInnerContainer, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
          <GengalAvatar data={data} size={86} />
        </View>
      )}
    </Pressable>
  );
}

export default function FinalizeInviteScreen({ navigation, navigate: directNavigate, route }: any) {
  const { height } = useWindowDimensions();
  const navigate = directNavigate || navigation?.navigate || (() => {});
  const { params } = route || {};
  const [builderCategory, setBuilderCategory] = useState<BuilderCategory>('hair');
  
  const [effectiveGender, setEffectiveGender] = useState<'Masculine' | 'Feminine'>(() => {
    if (params?.gender) {
      if (Platform.OS === 'web') {
        try { sessionStorage.setItem('draft_gender', params.gender); } catch (e) {}
      }
      return params.gender;
    }
    if (Platform.OS === 'web') {
      try { return (sessionStorage.getItem('draft_gender') as any) || 'Masculine'; } catch (e) {}
    }
    return 'Masculine';
  });

  useEffect(() => {
    if (params?.gender && params.gender !== effectiveGender) {
      setEffectiveGender(params.gender);
      if (Platform.OS === 'web') {
        try { sessionStorage.setItem('draft_gender', params.gender); } catch (e) {}
      }
    }
  }, [params?.gender]);
  
  const isFem = effectiveGender === 'Feminine';
  const isMasc = !isFem;

  const getInitialAvatar = (masc: boolean): AvatarData => {
    if (params?.isEditMode && params?.existingAvatarData) {
      return params.existingAvatarData;
    }
    return masc 
      ? { ...DEFAULT_AVATAR_DNA, topType: 'shortWaved', clotheType: 'shirtCrewNeck', facialHairType: 'beardLight', isPremiumConfig: true }
      : { ...DEFAULT_AVATAR_DNA, topType: 'longButNotTooLong', clotheType: 'shirtScoopNeck', facialHairType: 'none', isPremiumConfig: true };
  };

  const [avatarData, setAvatarData] = useState<AvatarData>(getInitialAvatar(isMasc));

  useEffect(() => {
    setAvatarData(getInitialAvatar(effectiveGender === 'Masculine'));
  }, [effectiveGender]);
  const isExpandedRef = useRef(false);
  const EXPAND_OFFSET = 240;
  const sheetTranslateY = useRef(new Animated.Value(EXPAND_OFFSET)).current;

  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        let newY = isExpandedRef.current ? gestureState.dy : EXPAND_OFFSET + gestureState.dy;
        if (newY < 0) newY = 0;
        if (newY > EXPAND_OFFSET) newY = EXPAND_OFFSET;
        sheetTranslateY.setValue(newY);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dy) < 8) {
          toggleSheet(!isExpandedRef.current);
          return;
        }
        if (gestureState.vy > 0.5 || gestureState.dy > EXPAND_OFFSET / 2) {
          toggleSheet(false);
        } else {
          toggleSheet(true);
        }
      },
    })
  ).current;

  const toggleSheet = (expand: boolean) => {
    isExpandedRef.current = expand;
    Animated.spring(sheetTranslateY, {
      toValue: expand ? 0 : EXPAND_OFFSET,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  };

  const updateAvatar = (patch: Partial<AvatarData>) => {
    setAvatarData((current) => ({ ...current, ...patch, isPremiumConfig: true }));
  };

  const isOptionSelected = (option: Partial<AvatarData>) => {
    return Object.keys(option).every((key) => (avatarData as any)[key] === (option as any)[key]);
  };

  const renderOptionSection = (title: string, options: Partial<AvatarData>[]) => (
    <View style={styles.optionSection}>
      <Text style={styles.optionSectionTitle}>{title}</Text>
      <View style={styles.optionGrid}>
        {options.map((option, idx) => (
          <AvatarOption key={idx} data={{ ...avatarData, ...option }} selected={isOptionSelected(option)} onPress={() => updateAvatar(option)} />
        ))}
      </View>
    </View>
  );

  const renderOptionGrid = () => {
    if (builderCategory === 'hair') {
      return (
        <View style={styles.sectionsContainer}>
          {isMasc ? renderOptionSection('MENS', HAIR_MEN) : null}
          {isFem ? renderOptionSection('WOMENS', HAIR_WOMEN) : null}
        </View>
      );
    }

    if (builderCategory === 'face') {
      return (
        <View style={styles.sectionsContainer}>
          {isMasc ? renderOptionSection('MENS', FACE_MEN) : null}
          {isFem ? renderOptionSection('WOMENS', FACE_WOMEN) : null}
        </View>
      );
    }

    if (builderCategory === 'style') {
      return (
        <View style={styles.sectionsContainer}>
          {isMasc ? renderOptionSection('MENS', CLOTHING_MEN) : null}
          {isFem ? renderOptionSection('WOMENS', CLOTHING_WOMEN) : null}
        </View>
      );
    }

    return (
      <View style={styles.sectionsContainer}>
        {renderOptionSection('EYEWEAR', EXTRAS_EYEWEAR)}
        {isMasc ? renderOptionSection('HEADWEAR', HEADWEAR_MEN) : null}
        {isFem ? renderOptionSection('HEADWEAR', HEADWEAR_WOMEN) : null}
      </View>
    );
  };

  const renderStudio = () => (
    <View style={styles.builder}>
      <View style={[styles.builderTopActions, { top: Math.max((Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44) + 10, 50) }]}>
        <Pressable onPress={() => navigate('ProfileDetails', { ...params, gender: effectiveGender })}>
          {({ pressed }) => (
            <View style={[styles.builderCircleBtn, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
              <MaterialIcons name="arrow-back" size={26} color={skeuo.plum} />
            </View>
          )}
        </Pressable>
        <View style={styles.topRightActions}>
          <Pressable onPress={() => {
            setAvatarData(getInitialAvatar(effectiveGender === 'Masculine'));
          }}>
            {({ pressed }) => (
              <View style={[styles.pillButton, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                <MaterialIcons name="undo" size={20} color={skeuo.plum} />
                <Text style={styles.pillText}>Revert</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={async () => {
            if (params?.isEditMode) {
              if (auth.currentUser) {
                await saveUserProfile(auth.currentUser.uid, {
                  avatarData
                });
                Alert.alert('Success', 'Avatar updated successfully!');
                navigate(params?.returnTo || 'Settings');
              }
            } else {
              navigate('CreatePassword', { ...params, avatar: avatarData });
            }
          }}>
            {({ pressed }) => (
              <View style={[styles.pillButton, styles.pillButtonPrimary, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                <MaterialIcons name="check" size={20} color="#1E1E1E" />
                <Text style={styles.pillTextPrimary}>{params?.isEditMode ? 'Save Avatar' : 'Continue'}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <View style={[styles.avatarStage, { paddingBottom: height < 750 ? 120 : 240 }]}>
        <View style={[styles.previewGlow, { width: Math.min(260, height * 0.35), height: Math.min(260, height * 0.35), borderRadius: Math.min(260, height * 0.35) / 2 }]} />
        <GengalAvatar data={avatarData} size={Math.min(300, height * 0.4)} />
      </View>

      <Animated.View style={[
        styles.builderSheet, 
        { transform: [{ translateY: sheetTranslateY }] }
      ]}>
        <View style={styles.sheetInner}>
          <View style={styles.sheetHandleWrapper} {...sheetPanResponder.panHandlers}>
            <View style={styles.sheetHandle} />
          </View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{CATEGORY_LABELS[builderCategory]}</Text>
          </View>

          <View style={{ flexGrow: 0 }}>
            <View style={styles.swatchRow}>
              
              {builderCategory === 'face' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>SKIN</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {SKIN_OPTIONS.map((skinColor) => (
                      <Pressable
                        key={skinColor}
                        style={[styles.swatch, avatarData.skinColor === skinColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ skinColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: getSkinHex(skinColor) }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
                  
              {builderCategory === 'hair' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>HAIR COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {HAIR_COLOR_OPTIONS.map((hairColor) => (
                      <Pressable
                        key={hairColor}
                        style={[styles.swatch, avatarData.hairColor === hairColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ hairColor, facialHairColor: hairColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: getHairHex(hairColor) }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {builderCategory === 'style' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>CLOTHING COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {CLOTHING_COLOR_OPTIONS.map((clotheColor) => (
                      <Pressable
                        key={clotheColor}
                        style={[styles.swatch, avatarData.clotheColor === clotheColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ clotheColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: getClothingHex(clotheColor) }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {builderCategory === 'accessory' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>BACKGROUND COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {BG_COLOR_OPTIONS.map((bgColor) => (
                      <Pressable
                        key={bgColor}
                        style={[styles.swatch, avatarData.backgroundColor === bgColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ backgroundColor: bgColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: bgColor }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

            </View>
          </View>

          <ScrollView style={styles.optionScroll} contentContainerStyle={styles.optionScrollContent} showsVerticalScrollIndicator={false}>
            {renderOptionGrid()}
          </ScrollView>
        </View>
      </Animated.View>

      <View style={styles.builderCategoryBar}>
        <BuilderTab icon="face-retouching-natural" label="Hair" active={builderCategory === 'hair'} onPress={() => setBuilderCategory('hair')} />
        <BuilderTab icon="mood" label="Face" active={builderCategory === 'face'} onPress={() => setBuilderCategory('face')} />
        <BuilderTab icon="checkroom" label="Clothing" active={builderCategory === 'style'} onPress={() => setBuilderCategory('style')} />
        <BuilderTab icon="visibility" label="Extras" active={builderCategory === 'accessory'} onPress={() => setBuilderCategory('accessory')} />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.contentArea}>
        {renderStudio()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: skeuo.surface },
  builder: { flex: 1, backgroundColor: '#F0E5D4' },
  builderTopActions: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  builderCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 4,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  topRightActions: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 1,
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: skeuo.surfaceRaised,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 4,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  pillButtonPrimary: {
    backgroundColor: '#ffd700',
    borderColor: '#CBA72F',
  },
  pillText: { color: skeuo.plum, fontSize: 13, fontWeight: '800' },
  pillTextPrimary: { color: '#1E1E1E', fontSize: 13, fontWeight: '900' },
  avatarStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
    paddingBottom: 240,
  },
  previewGlow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#FFFFFF',
    opacity: 0.4,
    boxShadow: Platform.OS === 'web' ? '0 10px 40px rgba(255,255,255,0.8)' : undefined,
  },
  builderSheet: {
    position: 'absolute',
    bottom: 92,
    left: 16,
    right: 16,
    height: 480,
    backgroundColor: 'transparent',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 20,
    shadowColor: '#3A2000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  sheetInner: {
    flex: 1,
    backgroundColor: skeuo.surfaceRaised,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: skeuo.border,
  },
  sheetHandleWrapper: {
    width: '100%',
    paddingVertical: 18,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 64,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D9C58B',
  },
  sheetHeader: {
    paddingHorizontal: 38,
    paddingTop: 8,
    paddingBottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { color: skeuo.plum, fontSize: 32, fontWeight: '900', fontFamily: 'serif' },
  swatchRow: { paddingHorizontal: 22, paddingBottom: 16, alignItems: 'flex-start', flexDirection: 'column', gap: 20 },
  swatchGroup: { gap: 10, width: '100%' },
  swatchGroupLabel: { color: '#9A8772', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  swatchList: { flexDirection: 'row', gap: 14, paddingRight: 40 },
  swatch: { 
    width: 44, 
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: { borderColor: '#EAB308' },
  swatchInner: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    backgroundColor: skeuo.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  swatchColorFill: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  optionScroll: { flex: 1 },
  optionScrollContent: {
    paddingBottom: 20,
  },
  sectionsContainer: {
    gap: 30,
    paddingTop: 10,
  },
  optionSection: {
    width: '100%',
  },
  optionSectionTitle: {
    color: '#8A6715',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginLeft: 22,
    marginBottom: 16,
  },
  optionGrid: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 10,
    rowGap: 17,
  },
  avatarOption: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarOptionActive: { borderColor: '#EAB308' },
  avatarOptionInnerContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    backgroundColor: skeuo.surfaceRaised,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOptionDarkSquare: {
    flex: 1,
    backgroundColor: '#1E1E24',
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  builderCategoryBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: skeuo.surfaceRaised,
    paddingHorizontal: 20,
    zIndex: 20,
    borderTopWidth: 1,
    borderColor: skeuo.border,
  },
  builderTab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  builderTabLabel: {
    color: '#9A8772',
    fontSize: 11,
    fontWeight: '800',
  },
  builderTabLabelActive: {
    color: skeuo.plum,
  },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    backgroundColor: skeuo.surfaceRaised,
    borderBottomWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? '0 8px 18px rgba(83, 58, 29, 0.10)' : undefined,
  },
  brand: { color: skeuo.plum, fontFamily: 'serif', fontSize: 28, fontWeight: '900' },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: skeuo.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  contentArea: { flex: 1 },
  infoContainer: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 112 },
  infoTitle: { color: skeuo.plum, fontFamily: 'serif', fontSize: 30, fontWeight: '900', marginBottom: 22 },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F8EA',
    padding: 12,
    borderRadius: 16,
    marginBottom: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: '#D7EDC8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  successText: { color: '#4F8B36', fontSize: 13, fontWeight: '800' },
  formGroup: { marginBottom: 18 },
  label: { fontSize: 11, fontWeight: '900', color: '#9A8772', marginBottom: 8, letterSpacing: 1.1 },
  input: {
    backgroundColor: '#FFFDF8',
    borderRadius: 18,
    height: 54,
    paddingHorizontal: 17,
    color: skeuo.plum,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  genderToggleFrame: {
    flexDirection: 'row',
    backgroundColor: '#F0E5D4',
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  toggleBtn: { flex: 1, height: 42, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  activeMasculine: { backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#D9C58B', boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  activeFeminine: { backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#D9C58B', boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  toggleBtnText: { fontSize: 12, fontWeight: '900', color: '#9A8772', letterSpacing: 1 },
  textActive: { color: skeuo.plum },
  saveActionBtn: { width: '100%', height: 58, borderRadius: 29, marginTop: 30, overflow: 'hidden', boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined },
  saveGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  saveActionText: { color: '#563F00', fontWeight: '900', fontSize: 14, letterSpacing: 1.6 },
  footerTabBar: {
    backgroundColor: skeuo.surfaceRaised,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: 1,
    borderColor: skeuo.border,
  },
  tabBtn: { marginHorizontal: 18, borderRadius: 18, padding: 10, alignItems: 'center', justifyContent: 'center', flex: 1 },
  tabLabel: { fontSize: 13, color: '#9A8772', fontWeight: '900', marginTop: 4, letterSpacing: 0.5 },
  activeTabLabel: { color: skeuo.plum },
});
