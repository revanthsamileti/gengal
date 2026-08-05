import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../config/firebase';
import { saveUserProfile } from './userService';

const STORAGE_KEY = 'gengal.languagePreference';

/**
 * The language screen runs in two places: before sign-in (onboarding) and from
 * Settings afterwards. Neither used to persist anything, so the choice was
 * discarded the moment the screen unmounted.
 *
 * A local copy is always written so onboarding survives a restart; the profile
 * is updated as well once there is an account to attach it to.
 */
export async function saveLanguagePreference(languageId: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, languageId);

  const user = auth.currentUser;
  if (user) {
    await saveUserProfile(user.uid, { language: languageId });
  }
}

/** Locally stored preference, used to preselect before the profile loads. */
export async function getStoredLanguagePreference(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
