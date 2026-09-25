// functions/index.js
// Bu dosya Firebase Cloud Functions'a YUKLENMESI gereken sunucu tarafi koddur.
// "duyurular" koleksiyonuna yeni bir doküman eklendiginde (admin panelinden
// "Duyuru Gonder" ile), kayitli tum telefonlara (pushTokens koleksiyonu)
// push bildirimi gonderir. Gecersiz/silinmis token'lari otomatik temizler.

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

exports.sendDuyuruPush = onDocumentCreated("duyurular/{duyuruId}", async (event) => {
  const data = event.data.data();
  const title = data.title || "LED Saha";
  const body = data.message || "";

  const tokensSnap = await db.collection("pushTokens").get();
  if (tokensSnap.empty) {
    console.log("Kayitli push token yok, bildirim gonderilmedi.");
    return;
  }

  const tokens = tokensSnap.docs.map((d) => d.data().token).filter(Boolean);
  if (tokens.length === 0) return;

  // FCM tek seferde en fazla 500 token kabul eder; 500'luk gruplara bolelim.
  const chunkSize = 500;
  const invalidTokens = [];

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    const response = await getMessaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      webpush: {
        notification: {
          icon: "icons/icon-192.png"
        }
      }
    });

    response.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.push(chunk[idx]);
        }
      }
    });
  }

  // Artik gecersiz olan token'lari Firestore'dan temizle.
  const cleanupPromises = [];
  tokensSnap.docs.forEach((docSnap) => {
    if (invalidTokens.includes(docSnap.data().token)) {
      cleanupPromises.push(docSnap.ref.delete());
    }
  });
  await Promise.all(cleanupPromises);

  console.log(
    `Duyuru gonderildi: ${tokens.length - invalidTokens.length} basarili, ${invalidTokens.length} gecersiz token temizlendi.`
  );
});
