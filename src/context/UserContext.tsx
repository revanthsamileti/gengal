import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import {
  subscribeToUserProfile,
  UserProfile as FirebaseUser,
  setHeartbeatEnabled,
} from '../services/userService';

type UserContextType = {
  profile: FirebaseUser | null;
};

const UserContext = createContext<UserContextType>({ profile: null });

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<FirebaseUser | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (unsub) {
        unsub();
        unsub = undefined;
      }
      if (user) {
        // Reset the gate at the top of every session so a prior user's
        // preference doesn't bleed into the new account.
        setHeartbeatEnabled(true);
        unsub = subscribeToUserProfile(user.uid, (data) => {
          setProfile(data ? { ...data, uid: user.uid } : null);
          // Keep the heartbeat gate in sync with the user's Active Mode toggle.
          // Reading it from the live profile snapshot rather than from local
          // toggle state means the gate is correct even if the preference was
          // changed from another device or via the admin panel.
          setHeartbeatEnabled(data?.isActiveMode !== false);
        });
      } else {
        // Sign-out: reset the gate so the next session starts unblocked.
        setHeartbeatEnabled(true);
        setProfile(null);
      }
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  return (
    <UserContext.Provider value={{ profile }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
