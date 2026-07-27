const admin = require('firebase-admin');
const serviceAccount = require('./backend/serviceAccountKey.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();
(async () => {
    const snapshot = await db.collection('public_rooms').get();
    for (let doc of snapshot.docs) {
        if (doc.data().status === 'busy') {
            console.log('Fixing', doc.id);
            await doc.ref.update({ status: 'available' });
        }
    }
    console.log('Done');
    process.exit(0);
})();
