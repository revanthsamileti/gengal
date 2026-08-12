import { db } from '../config/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  setDoc, 
  doc, 
  updateDoc,
  serverTimestamp,
  onSnapshot,
  runTransaction,
  getDoc
} from 'firebase/firestore';
import { UserProfile } from './userService';
import { snapshotError, SubscriptionErrorHandler } from './subscriptionError';

export interface MatchRoom {
  id?: string;
  status: 'active' | 'closed';
  host: {
    uid: string;
    nickname: string;
    avatarData: any;
  };
  guest: {
    uid: string;
    nickname: string;
    avatarData: any;
  };
  createdAt: any;
}

const normalizeMatchGender = (gender?: string | null): 'male' | 'female' | null => {
  const value = (gender || '').trim().toLowerCase();
  if (['male', 'man', 'masculine', 'boy'].includes(value)) return 'male';
  if (['female', 'woman', 'feminine', 'girl'].includes(value)) return 'female';
  return null;
};

export const findMatch = async (
  currentUser: UserProfile,
  preferredMode: 'video' | 'call',
  onMatchFound: (roomId: string, matchData: any) => void,
  /**
   * Called if the waiting listener dies. Without it a failed subscription is
   * indistinguishable from "nobody has matched yet", and the user watches a
   * spinner forever — including in the case where somebody *did* match with
   * them and the write simply never reached this device.
   */
  onError?: SubscriptionErrorHandler,
) => {
  const poolRef = collection(db, 'matchmaking_pool');
  const roomsRef = collection(db, 'rooms');

  try {
    // 1. Try to find someone currently searching
    const q = query(poolRef, where('status', '==', 'searching'));
    const snapshot = await getDocs(q);
    
    const myGender = normalizeMatchGender(currentUser.gender);
    const targetGender = myGender === 'female' ? 'male' : (myGender === 'male' ? 'female' : null);

    let opponentDoc = null;
    for (const d of snapshot.docs) {
      if (d.id !== currentUser.uid) {
        const oppData = d.data();
        const oppGender = normalizeMatchGender(oppData.gender);
        
        // Filter by mode and opposite gender
        if (oppData.preferredMode === preferredMode && oppGender === targetGender) {
          opponentDoc = d;
          break;
        }
      }
    }

    if (opponentDoc) {
      // 2a. Found someone! Perform a transaction to safely pair them up
      const opponentData = opponentDoc.data();
      
      const roomId = opponentDoc.id + '_' + currentUser.uid + '_' + Date.now();
      const newRoomRef = doc(roomsRef, roomId);
      
      await runTransaction(db, async (transaction) => {
        // Read opponent again to ensure they haven't been matched
        const oppSnapshot = await transaction.get(opponentDoc.ref);
        if (!oppSnapshot.exists() || oppSnapshot.data().status !== 'searching') {
          throw new Error("Opponent already matched");
        }

        // Create the room
        transaction.set(newRoomRef, {
          status: 'active',
          audioProvider: 'agora', // Defaulting to Agora as the primary engine per the 40K architecture
          host: {
            uid: opponentDoc.id,
            nickname: opponentData.nickname || 'Host',
            avatarData: opponentData.avatarData || null
          },
          guest: {
            uid: currentUser.uid!,
            nickname: currentUser.nickname || 'Guest',
            avatarData: currentUser.avatarData || null
          },
          createdAt: serverTimestamp()
        });

        // Update opponent's pool status so they get notified
        transaction.update(opponentDoc.ref, {
          status: 'matched',
          matchedRoomId: roomId
        });
      });

      // Notify the caller immediately
      onMatchFound(roomId, {
        uid: opponentDoc.id,
        nickname: opponentData.nickname || 'Host',
        avatarData: opponentData.avatarData || null,
        audioProvider: 'agora',
      });

      return () => {}; // Cleanup function (none needed for guest)

    } else {
      // 2b. Nobody is searching. Join the pool and wait!
      const myPoolRef = doc(poolRef, currentUser.uid!);
      await setDoc(myPoolRef, {
        uid: currentUser.uid,
        nickname: currentUser.nickname || 'User',
        avatarData: currentUser.avatarData || null,
        gender: currentUser.gender || '',
        preferredMode,
        status: 'searching',
        matchedRoomId: null,
        joinedAt: serverTimestamp()
      });

      // Listen for when someone matches with US
      const unsubscribe = onSnapshot(myPoolRef, async (docSnap) => {
        const data = docSnap.data();
        if (data && data.status === 'matched' && data.matchedRoomId) {
          unsubscribe(); // Stop listening
          
          // Fetch the room to get the guest's (opponent's) data
          const roomRef = doc(roomsRef, data.matchedRoomId);
          const roomSnap = await getDoc(roomRef);
          const roomData = roomSnap.data();
          
          if (roomData && roomData.guest) {
            onMatchFound(data.matchedRoomId, {
              ...roomData.guest,
              audioProvider: roomData.audioProvider || 'agora',
              audioTokenOrUrl: roomData.audioTokenOrUrl || ''
            });
          }
          
          // Clean up our pool entry since we are now in a room
          await updateDoc(myPoolRef, { status: 'in_room' });
        }
      }, snapshotError('match:waitingForPartner', onError));

      // Return a cleanup function in case the user cancels searching early
      return () => {
        unsubscribe();
        updateDoc(myPoolRef, { status: 'cancelled' }).catch(() => {});
      };
    }
  } catch (err) {
    console.error("Matchmaking error:", err);
    throw err;
  }
};
