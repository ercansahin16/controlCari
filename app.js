// app.js — Cari Takip uygulama mantığı (Firestore ile)

import { db } from "./firebase-core.js";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---- PIN ayari ----
// BURAYI DEGISTIR: kendi PIN'ini yaz. Bu sadece ekrani gizler, gercek
// bir guvenlik degildir (sayfa kaynagina bakan gorebilir). Firestore
// kurallarini da ayri ayri kisitlaman gerekir.
const APP_PIN = "1234";
const UNLOCK_KEY = "cariTakip_unlocked_v1";

const COLLECTION_NAME = "cariler";
const cariCollection = collection(db, COLLECTION_NAME);

var cariler = []; // Firestore'dan gelen canli liste: {id, name, debt, note, due, flagged}
var currentDocId = null;

function normalizeHeader(h){
  return (h === null || h === undefined ? "" : h.toString()).toLocaleLowerCase("tr").trim();
}

function findCol(headers, keywords){
  for (var i = 0; i < headers.length; i++){
    var h = normalizeHeader(headers[i]);
    for (var k = 0; k < keywords.length; k++){
      if (h.indexOf(keywords[k]) !== -1) return i;
    }
  }
  return -1;
}

function parseNumber(v){
  if (typeof v === "number") return v;
  if (!v) return 0;
  var s = v.toString().replace(/[^0-9,.\-]/g, "");
  if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1){
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.indexOf(",") !== -1){
    s = s.replace(",", ".");
  }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtMoney(n){
  return (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Firestore dokuman ID'si icin ismi guvenli hale getir ("/" izinli degil)
function docIdFor(name){
  var safe = name.toString().trim().replace(/\//g, "_");
  if (safe.length > 400) safe = safe.substring(0, 400);
  return safe;
}

function escapeHtml(s){
  return (s || "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s){
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function setConnStatus(text, ok){
  var el = document.getElementById("connStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "var(--ok)" : "var(--warn)";
}

function render(){
  var list = document.getElementById("list");
  var q = document.getElementById("searchBox").value.toLocaleLowerCase("tr").trim();

  var filtered = cariler.filter(function(c){
    return !q || c.name.toLocaleLowerCase("tr").indexOf(q) !== -1;
  });

  if (cariler.length === 0){
    list.innerHTML = '<div class="empty">Henuz veri yok.<br/>Yukaridan bir Excel dosyasi yukleyin.<br/>Excel\u2019de "Cari Ismi" ve bakiye/borc kolonu olmali.</div>';
  } else if (filtered.length === 0){
    list.innerHTML = '<div class="empty">Sonuc bulunamadi.</div>';
  } else {
    filtered.sort(function(a, b){ return (b.debt || 0) - (a.debt || 0); });
    var html = "";
    for (var i = 0; i < filtered.length; i++){
      var c = filtered[i];
      var flaggedClass = c.flagged ? " flagged" : "";
      var debtClass = (c.debt || 0) === 0 ? " zero" : "";
      html += '<div class="row' + flaggedClass + '" data-id="' + escapeAttr(c.id) + '">';
      html += '  <div class="left">';
      html += '    <div class="name">' + escapeHtml(c.name) + '</div>';
      if (c.note){
        html += '    <div class="note-preview">' + escapeHtml(c.note) + '</div>';
      }
      if (c.due){
        html += '    <div class="due">Odeme bekleniyor: ' + escapeHtml(c.due) + '</div>';
      }
      html += '  </div>';
      html += '  <div class="right">';
      html += '    <div class="debt' + debtClass + '">' + fmtMoney(c.debt) + '</div>';
      if (c.flagged){
        html += '    <div class="badge">SORUNLU</div>';
      }
      html += '  </div>';
      html += '</div>';
    }
    list.innerHTML = html;

    var rows = list.querySelectorAll(".row");
    rows.forEach(function(row){
      row.addEventListener("click", function(){
        openDetail(row.getAttribute("data-id"));
      });
    });
  }

  document.getElementById("sumCount").textContent = cariler.length;
  var totalDebt = cariler.reduce(function(s, c){ return s + (c.debt || 0); }, 0);
  document.getElementById("sumDebt").textContent = fmtMoney(totalDebt);
  var flagCount = cariler.filter(function(c){ return c.flagged; }).length;
  document.getElementById("sumFlag").textContent = flagCount;
}

function openDetail(id){
  currentDocId = id;
  var c = cariler.find(function(x){ return x.id === id; });
  if (!c) return;

  document.getElementById("detailName").textContent = c.name;
  document.getElementById("detailDebt").textContent = "Kalan Bakiye: " + fmtMoney(c.debt);
  document.getElementById("noteInput").value = c.note || "";
  document.getElementById("dueInput").value = c.due || "";
  var sw = document.getElementById("flagSwitch");
  sw.classList.toggle("on", !!c.flagged);
  document.getElementById("saveStatus").textContent = "";
  document.getElementById("overlay").classList.add("show");
}

function closeDetail(){
  document.getElementById("overlay").classList.remove("show");
  currentDocId = null;
}

async function saveCurrentNote(){
  if (!currentDocId) return;
  var status = document.getElementById("saveStatus");
  var data = {
    note: document.getElementById("noteInput").value,
    due: document.getElementById("dueInput").value,
    flagged: document.getElementById("flagSwitch").classList.contains("on"),
    updatedAt: serverTimestamp()
  };
  status.textContent = "Kaydediliyor...";
  try {
    await setDoc(doc(db, COLLECTION_NAME, currentDocId), data, { merge: true });
    status.textContent = "Kaydedildi.";
    setTimeout(closeDetail, 400);
  } catch (e) {
    status.textContent = "Kaydedilemedi: " + e.message;
  }
}

async function deleteCurrent(){
  if (!currentDocId) return;
  if (!confirm("Bu cariyi tamamen silmek istediginize emin misiniz?")) return;
  var status = document.getElementById("saveStatus");
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, currentDocId));
    closeDetail();
  } catch (e) {
    status.textContent = "Silinemedi: " + e.message;
  }
}

async function handleExcelUpload(file){
  var label = document.getElementById("uploadLabel");
  label.textContent = "Okunuyor...";
  try {
    var buf = await file.arrayBuffer();
    var data = new Uint8Array(buf);
    var wb = XLSX.read(data, { type: "array" });
    var sheet = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (rows.length < 2){
      alert("Excel'de veri bulunamadi.");
      label.textContent = "Excel Yukle (.xlsx)";
      return;
    }

    var headers = rows[0];
    var nameCol = findCol(headers, ["cari isim", "cari ismi", "cari adi", "cari ad", "cari"]);
    var debtCol = findCol(headers, ["bakiye", "borc", "kalan"]);

    if (nameCol === -1){
      alert('Excel dosyasinda "Cari Ismi" kolonu bulunamadi. Kolon basliginda "cari" kelimesi gecmeli.');
      label.textContent = "Excel Yukle (.xlsx)";
      return;
    }

    label.textContent = "Yukleniyor 0/" + (rows.length - 1);
    var count = 0;
    var total = rows.length - 1;

    for (var i = 1; i < rows.length; i++){
      var r = rows[i];
      var nm = (r[nameCol] || "").toString().trim();
      if (!nm) continue;
      var debt = debtCol !== -1 ? parseNumber(r[debtCol]) : 0;
      var id = docIdFor(nm);

      // merge:true -> mevcut not/tarih/sorunlu bilgisi silinmez, sadece isim ve bakiye guncellenir
      await setDoc(doc(db, COLLECTION_NAME, id), {
        name: nm,
        debt: debt,
        updatedAt: serverTimestamp()
      }, { merge: true });

      count++;
      label.textContent = "Yukleniyor " + count + "/" + total;
    }

    label.textContent = "Excel Yukle (.xlsx)";
  } catch (err) {
    alert("Dosya okunurken hata olustu: " + err.message);
    label.textContent = "Excel Yukle (.xlsx)";
  }
}

function initRealtime(){
  setConnStatus("Baglaniyor...", false);
  onSnapshot(cariCollection, function(snapshot){
    cariler = [];
    snapshot.forEach(function(docSnap){
      var d = docSnap.data();
      cariler.push({
        id: docSnap.id,
        name: d.name || docSnap.id,
        debt: d.debt || 0,
        note: d.note || "",
        due: d.due || "",
        flagged: !!d.flagged
      });
    });
    setConnStatus("Canli baglanti aktif", true);
    render();
  }, function(error){
    setConnStatus("Baglanti hatasi: " + error.message, false);
  });
}

function wireEvents(){
  document.getElementById("flagSwitch").addEventListener("click", function(){
    this.classList.toggle("on");
  });
  document.getElementById("closeBtn").addEventListener("click", closeDetail);
  document.getElementById("deleteBtn").addEventListener("click", deleteCurrent);
  document.getElementById("overlay").addEventListener("click", function(e){
    if (e.target === this) closeDetail();
  });
  document.getElementById("saveBtn").addEventListener("click", saveCurrentNote);
  document.getElementById("searchBox").addEventListener("input", render);
  document.getElementById("fileInput").addEventListener("change", function(e){
    var file = e.target.files[0];
    if (file) handleExcelUpload(file);
    e.target.value = "";
  });
}

function unlockApp(){
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("locked");
  wireEvents();
  initRealtime();
}

function wirePinScreen(){
  var input = document.getElementById("pinInput");
  var btn = document.getElementById("pinSubmit");
  var err = document.getElementById("pinError");

  function tryUnlock(){
    if (input.value === APP_PIN){
      try { localStorage.setItem(UNLOCK_KEY, "1"); } catch (e) {}
      unlockApp();
    } else {
      err.textContent = "Yanlis PIN.";
      input.value = "";
      input.focus();
    }
  }

  btn.addEventListener("click", tryUnlock);
  input.addEventListener("keydown", function(e){
    if (e.key === "Enter") tryUnlock();
  });
  input.focus();
}

var alreadyUnlocked = false;
try { alreadyUnlocked = localStorage.getItem(UNLOCK_KEY) === "1"; } catch (e) {}

if (alreadyUnlocked){
  unlockApp();
} else {
  wirePinScreen();
}
