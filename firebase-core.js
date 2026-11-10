// firebase-core.js (SADECE BAĞLANTI)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBY73WR7wSypPln0QeQzFeXM7jyJzCoWWQ",
  authDomain: "carikontrol-22155.firebaseapp.com",
  projectId: "carikontrol-22155",
  storageBucket: "carikontrol-22155.firebasestorage.app",
  messagingSenderId: "830194055469",
  appId: "1:830194055469:web:343b0663162bdd97befba4"
};

const app = initializeApp(firebaseConfig);
export { app };
export const db = getFirestore(app);

// Çevrimdışı önbellek: sayfa her açıldığında tüm koleksiyonu baştan okumaz,
// sadece değişenleri okur (okuma sayısını ciddi düşürür).
try { enableMultiTabIndexedDbPersistence(db).catch(function(){}); } catch (e) {}
