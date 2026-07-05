import { db } from '../config/firebase';
import { doc, runTransaction, getDoc, updateDoc } from 'firebase/firestore';

/**
 * Deducts coins safely using an atomic transaction.
 * Use this when a user purchases an item or service.
 */
export const deductUserCoins = async (userId: string, amount: number) => {
  if (amount <= 0) throw new Error("Amount must be positive");

  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) {
      throw new Error("User does not exist!");
    }

    const currentBalance = userDoc.data()?.coins || 0;
    if (currentBalance < amount) {
      throw new Error("Insufficient Gengal balance");
    }

    transaction.update(userRef, { coins: currentBalance - amount });
    return currentBalance - amount; // Return the new balance
  });
};

/**
 * Credits coins safely.
 * Use this when a user receives a gift, refund, or top-up.
 */
export const creditUserCoins = async (userId: string, amount: number) => {
  if (amount <= 0) throw new Error("Amount must be positive");

  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) {
      throw new Error("User does not exist!");
    }

    const currentBalance = userDoc.data()?.coins || 0;
    transaction.update(userRef, { coins: currentBalance + amount });
    return currentBalance + amount; // Return the new balance
  });
};

/**
 * Safely transfers coins between two users in a single atomic transaction.
 * This guarantees that either BOTH operations succeed, or NEITHER do.
 */
export const transferCoins = async (senderId: string, receiverId: string, amount: number) => {
  if (amount <= 0) throw new Error("Amount must be positive");
  if (senderId === receiverId) throw new Error("Cannot send gifts to yourself");

  const senderRef = doc(db, 'users', senderId);
  const receiverRef = doc(db, 'users', receiverId);

  return runTransaction(db, async (transaction) => {
    // 1. Read BOTH documents first (Firestore transactions require all reads before any writes)
    const senderDoc = await transaction.get(senderRef);
    const receiverDoc = await transaction.get(receiverRef);

    if (!senderDoc.exists() || !receiverDoc.exists()) {
      throw new Error("Sender or receiver does not exist.");
    }

    const senderBalance = senderDoc.data()?.coins || 0;
    const receiverBalance = receiverDoc.data()?.coins || 0;

    if (senderBalance < amount) {
      throw new Error("Insufficient Gengal balance for transfer");
    }

    // 2. Perform BOTH writes
    transaction.update(senderRef, { coins: senderBalance - amount });
    transaction.update(receiverRef, { coins: receiverBalance + amount });

    return {
      success: true,
      senderNewBalance: senderBalance - amount,
      receiverNewBalance: receiverBalance + amount
    };
  });
};

/**
 * Processes per-minute call billing.
 * Deducts the total amount from the payer, and credits the specified share percentage to the receiver.
 * The remaining amount is effectively kept by the platform (admin).
 */
export const processCallBilling = async (payerId: string, receiverId: string, totalAmount: number, creatorSharePercentage: number) => {
  if (totalAmount <= 0) throw new Error("Amount must be positive");
  if (creatorSharePercentage < 0 || creatorSharePercentage > 100) throw new Error("Invalid share percentage");
  if (payerId === receiverId) return { success: true, hasInsufficientFunds: false }; // No billing for self-testing

  const payerRef = doc(db, 'users', payerId);
  const receiverRef = doc(db, 'users', receiverId);

  return runTransaction(db, async (transaction) => {
    const payerDoc = await transaction.get(payerRef);
    const receiverDoc = await transaction.get(receiverRef);

    if (!payerDoc.exists() || !receiverDoc.exists()) {
      throw new Error("Payer or receiver does not exist.");
    }

    const payerBalance = payerDoc.data()?.coins || 0;
    const receiverBalance = receiverDoc.data()?.coins || 0;

    let actualDeduction = totalAmount;
    let hasInsufficientFunds = false;

    if (payerBalance < totalAmount) {
      actualDeduction = payerBalance;
      hasInsufficientFunds = true;
    }

    // Dynamic fractional share for the receiver based on the global percentage
    const receiverShare = actualDeduction * (creatorSharePercentage / 100);

    transaction.update(payerRef, { coins: payerBalance - actualDeduction });
    transaction.update(receiverRef, { coins: receiverBalance + receiverShare });

    return {
      success: true,
      hasInsufficientFunds,
      payerNewBalance: payerBalance - actualDeduction,
      receiverNewBalance: receiverBalance + receiverShare
    };
  });
};

/**
 * Updates a user's cumulative call time and awards hearts if they cross the threshold.
 */
export const updateCallRewards = async (userId: string, secondsToAdd: number, thresholdMinutes: number, isReceiver: boolean = false) => {
  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) return;

    const data = userDoc.data();
    let currentSeconds = data.unrewardedCallSeconds || 0;
    let currentHearts = data.hearts || 0;
    let totalReceived = data.totalReceivedCallSeconds || 0;

    if (isReceiver) {
      totalReceived += secondsToAdd;
    }

    currentSeconds += secondsToAdd;
    const thresholdSeconds = thresholdMinutes * 60;

    let newHearts = currentHearts;
    if (thresholdSeconds > 0 && currentSeconds >= thresholdSeconds) {
      const heartsToAward = Math.floor(currentSeconds / thresholdSeconds);
      newHearts += heartsToAward;
      currentSeconds = currentSeconds % thresholdSeconds;
    }

    transaction.update(userRef, {
      unrewardedCallSeconds: currentSeconds,
      hearts: newHearts,
      ...(isReceiver ? { totalReceivedCallSeconds: totalReceived } : {})
    });
  });
};
