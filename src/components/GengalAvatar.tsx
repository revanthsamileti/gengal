import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, Image } from 'react-native';
import { createAvatar } from '@dicebear/core';
import { avataaars } from '@dicebear/collection';
import { SvgXml } from 'react-native-svg';

export interface AvatarData {
  topType: string;
  hairColor: string;
  clotheType: string;
  clotheColor?: string;
  skinColor: string;
  facialHairType?: string;
  facialHairColor?: string;
  accessoriesType?: string;
  mouthType?: string;
  eyeType?: string;
  eyebrowType?: string;
  isPremiumConfig?: boolean;
  bgColor?: string;
  backgroundColor?: string;
}

export const DEFAULT_AVATAR_DNA: AvatarData = {
  topType: "shortHairShortWaved",
  hairColor: "black",
  clotheType: "crewNeck",
  skinColor: "light",
  bgColor: "#E2E8F0"
};

const mapTop: Record<string, string> = {
  shortHairShortWaved: 'shortWaved',
  longHairBun: 'bun',
  longHairStraight: 'straight01',
  shortHairDreads01: 'dreads',
  shortHairShortCurly: 'shortCurly'
};

const mapHairColor: Record<string, string> = {
  black: '2c1b18',
  brownDark: '4a3123',
  blonde: 'd6b370',
  red: 'ca4420',
  silverGray: 'e8e8e8'
};

const mapClothing: Record<string, string> = {
  crewNeck: 'shirtCrewNeck',
  graphicShirt: 'graphicShirt',
  collarSweater: 'blazerAndShirt',
  blazerShirt: 'blazerAndSweater',
  hoodie: 'hoodie'
};

const mapSkinColor: Record<string, string> = {
  light: 'edb98a',
  tanned: 'd08b5b',
  brown: 'ae5d29',
  dark: '614335',
  black: '2d1e16'
};

const mapClothingColor: Record<string, string> = {
  black: '262e33',
  gray01: 'e6e6e6',
  blue02: '3c4f5c',
  pastelBlue: 'b1e2ff',
  pastelGreen: 'a7ffc4',
  pastelRed: 'ffafb9',
  pink: 'ff488e'
};

const mapFacialHair: Record<string, string> = {
  none: '',
  stubble: 'beardLight',
  fullBeard: 'beardMajestic',
  anchorMustache: 'moustacheFancy'
};

const mapAccessories: Record<string, string> = {
  none: '',
  designerEyewear: 'wayfarers',
  goldHoops: 'round',
  pearlChoker: 'kurt' // Closest approximation
};

export default function GengalAvatar({ data, size = 150 }: { data?: AvatarData; size?: number }) {
  const avatarDNA = data || DEFAULT_AVATAR_DNA;

  const svgString = useMemo(() => {
    try {
      const avatarOpts: any = {
        top: [(mapTop[avatarDNA.topType] || avatarDNA.topType || 'shortWaved')],
        hairColor: [(mapHairColor[avatarDNA.hairColor] || avatarDNA.hairColor || '2c1b18')],
        clothing: [(mapClothing[avatarDNA.clotheType] || avatarDNA.clotheType || 'shirtCrewNeck')],
        clothesColor: [(mapClothingColor[avatarDNA.clotheColor || ''] || avatarDNA.clotheColor || '262e33')],
        skinColor: [(mapSkinColor[avatarDNA.skinColor] || avatarDNA.skinColor || 'edb98a')],
        eyes: [avatarDNA.eyeType || "default"],
        eyebrows: [avatarDNA.eyebrowType || "defaultNatural"],
        mouth: [avatarDNA.mouthType || "smile"],
        backgroundColor: ["transparent"],
      };

      if (avatarDNA.facialHairType && avatarDNA.facialHairType !== 'none') {
        avatarOpts.facialHair = [mapFacialHair[avatarDNA.facialHairType] || avatarDNA.facialHairType];
        avatarOpts.facialHairColor = [(mapHairColor[avatarDNA.facialHairColor || avatarDNA.hairColor] || avatarDNA.facialHairColor || avatarDNA.hairColor || '2c1b18')];
        avatarOpts.facialHairProbability = 100;
      } else {
        avatarOpts.facialHairProbability = 0;
      }

      if (avatarDNA.accessoriesType && avatarDNA.accessoriesType !== 'none') {
        avatarOpts.accessories = [mapAccessories[avatarDNA.accessoriesType] || avatarDNA.accessoriesType];
        avatarOpts.accessoriesProbability = 100;
      } else {
        avatarOpts.accessoriesProbability = 0;
      }

      let rawSvg = createAvatar(avataaars, avatarOpts).toString();
      
      // react-native-svg on Android has a well-known bug where rx/ry in masks cuts the SVG exactly in half!
      // We remove the mask completely and rely on the React Native View's borderRadius instead.
      rawSvg = rawSvg.replace(/<mask id="viewboxMask">.*?<\/mask>/g, '');
      rawSvg = rawSvg.replace(/mask="url\(#viewboxMask\)"/g, '');

      return rawSvg;
    } catch (e) {
      console.warn("Avatar generation failed", e);
      return '';
    }
  }, [avatarDNA]);

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarDNA.bgColor || '#E2E8F0' }]}>
      {svgString ? (
        Platform.OS === 'web' ? (
          <Image 
            source={{ uri: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}` }} 
            style={{ width: '100%', height: '100%' }} 
          />
        ) : (
          <SvgXml xml={svgString} width={size} height={size} />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFDF8',
  },
});
