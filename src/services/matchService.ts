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

export const findMatch = async (
  currentUser: UserProfile, 
  onMatchFound: (roomId: string, matchData: any) => void
) => {
  const poolRef = collection(db, 'matchmaking_pool');
  const roomsRef = collection(db, 'rooms');

  try {
    // 1. Try to find someone currently searching
    const q = query(poolRef, where('status', '==', 'searching'));
    const snapshot = await getDocs(q);
    
    let opponentDoc = null;
    for (const d of snapshot.docs) {
      if (d.id !== currentUser.uid) {
        opponentDoc = d;
        break;
      }
    }

    if (opponentDoc) {
      // 2a. Found someone! Perform a transaction to safely pair them up
      const opponentData = opponentDoc.data();
      
      const roomId = opponentDoc.id + '_' + currentUser.uid;
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
          audioTokenOrUrl: 'TEST_TOKEN', // Placeholder for actual token generation
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
        audioTokenOrUrl: 'TEST_TOKEN'
      });

      return () => {}; // Cleanup function (none needed for guest)

    } else {
      // 2b. Nobody is searching. Join the pool and wait!
      const myPoolRef = doc(poolRef, currentUser.uid!);
      await setDoc(myPoolRef, {
        uid: currentUser.uid,
        nickname: currentUser.nickname || 'User',
        avatarData: currentUser.avatarData || null,
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
              audioTokenOrUrl: roomData.audioTokenOrUrl || 'TEST_TOKEN'
            });
          }
          
          // Clean up our pool entry since we are now in a room
          await updateDoc(myPoolRef, { status: 'in_room' });
        }
      });

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

