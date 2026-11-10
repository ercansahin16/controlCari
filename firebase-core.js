// firebase-core.js (SADECE BAĞLANTI)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBWj53RpZd_xcWGD-ZLIyXBYz8H9MehM7Y",
  authDomain: "dosya01-7a585.firebaseapp.com",
  databaseURL: "https://dosya01-7a585-default-rtdb.firebaseio.com",
  projectId: "dosya01-7a585",
  storageBucket: "dosya01-7a585.firebasestorage.app",
  messagingSenderId: "502419176600",
  appId: "1:502419176600:web:d4304f2a0bfc30d03ce4ed"
};

const app = initializeApp(firebaseConfig);
export { app };
export const db = getFirestore(app);

// Çevrimdışı önbellek: sayfa her açıldığında tüm koleksiyonu baştan okumaz,
// sadece değişenleri okur (okuma sayısını ciddi düşürür).
try { enableMultiTabIndexedDbPersistence(db).catch(function(){}); } catch (e) {}
