const admin = require('./firebase'); // az önce yazdığın firebase.js dosyası
const { Timestamp } = require('firebase-admin/firestore');

const checkVIPStatus = async () => {
  const usersRef = admin.firestore().collection('users');
  const snapshot = await usersRef.where('isVIP', '==', true).get();

  const now = Timestamp.now();

  for (const doc of snapshot.docs) {
    const userData = doc.data();
    const vipEnd = userData.vipSubscriptionEndDate;

    if (vipEnd && vipEnd.toMillis() < now.toMillis()) {
      // VIP süresi dolmuş
      await usersRef.doc(doc.id).update({
        isVIP: false,
        vipSubscriptionEndDate: null,
        vipSubscriptionStartDate: null,
      });

      console.log(`VIP expired: ${doc.id}`);
    }
  }

  console.log('VIP kontrolü tamamlandı.');
};

module.exports = checkVIPStatus;
