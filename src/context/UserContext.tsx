import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import { subscribeToUserProfile, UserProfile as FirebaseUser } from '../services/userService';

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
        unsub = subscribeToUserProfile(user.uid, (data) => {
          setProfile(data ? { ...data, uid: user.uid } : null);
        });
      } else {
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
