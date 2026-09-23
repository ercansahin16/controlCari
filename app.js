// app.js — Cari Takip: rol bazli giris, odeme onay/red akisi, gunluk basari,
// sofor tanimlama, yonetici filtreleri, gece kilidi, gecmis kaydi.

import { db } from "./firebase-core.js";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, getDocs,
  serverTimestamp, arrayUnion, arrayRemove,
  query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---- Yonetici PIN'i ----
// ---- Sifreler ----
// Yonetici hesaplari artik isim+kendi sifreleriyle (yoneticiler koleksiyonu).
// Plasiyer sifresi hala tek/ortak (config/sifreler.salesPin).
var currentSalesPin = "5678"; // Firestore yuklenene kadar varsayilan

const UNLOCK_KEY = "cariTakip_unlocked_v5";
const ROLE_KEY = "cariTakip_role_v5";
const USERNAME_KEY = "cariTakip_userName_v5";
const PLAKA_KEY = "cariTakip_plaka_v5";

const CARI_COLLECTION = "cariler";
const HISTORY_COLLECTION = "gecmis";
const PLAKA_DOC = { col: "config", id: "plakalar" };
const META_DOC = { col: "config", id: "meta" };
const SOFOR_DOC = { col: "config", id: "soforler" };
const AYARLAR_DOC = { col: "config", id: "ayarlar" };
const SIFRELER_DOC = { col: "config", id: "sifreler" };
const YONETICILER_COLLECTION = "yoneticiler";
const SUPER_ADMIN_ID = "ercan-sahin";
const ADMIN_DOC_ID_KEY = "cariTakip_adminDocId_v5";
const BASARI_DOC = { col: "config", id: "gunluk_basari" }; // artik kullanilmiyor (gecmis uyumluluk icin birakildi)
const GUNLUK_BAKIYE_COLLECTION = "gunluk_bakiye"; // her takvim gunu icin plaka -> toplam bakiye
const PLAKA_YOK = "PLAKA_YOK";

// Excelde bulunmasi zorunlu (sadece bunlar) kolonlar
const REQUIRED_COLUMNS = [
  { label: "Ünvan", match: ["ünvan", "unvan"] },
  { label: "Cari Kategori 1", match: ["cari kategori 1"] },
  { label: "Cari Kategori 5", match: ["cari kategori 5"] },
  { label: "Borç Bak.", match: ["borç bak", "borc bak"] },
  { label: "Son Tah. Tarihi", match: ["son tah"] }
];

var plakaDocRef = null;
var metaDocRef = null;
var soforDocRef = null;
var ayarlarDocRef = null;
var sifrelerDocRef = null;

var cariler = [];
var plakaListesi = [];
var soforMap = {}; // plaka -> isim
var minBakiye = 250; // bu tutarin altindaki bakiyeler tum listelerden gizlenir
var lastUploadAt = null;

var currentDocId = null;
var currentUserName = "";
var currentRole = "";
var currentPlakalar = [];
var currentAdminDocId = "";
var adminUsers = []; // {id, name, password, isSuper}
var nightLockActive = false;
var nightLockBypassed = false;
var appWired = false;

var unsubCariler = null;
var unsubHistory = null;
var nightLockInterval = null;

var calViewYear, calViewMonth;
var calSelectedISO = "";

// ---------- Yardimci fonksiyonlar ----------

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
  if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1){ s = s.replace(/\./g, "").replace(",", "."); }
  else if (s.indexOf(",") !== -1){ s = s.replace(",", "."); }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function fmtMoney(n){ return (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDateISOtoTR(iso){
  if (!iso) return "";
  var p = iso.split("-");
  if (p.length !== 3) return iso;
  return p[2] + "." + p[1] + "." + p[0];
}
function fmtTimestamp(ts){
  if (!ts) return "";
  try {
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ""; }
}
function docIdFor(name){
  var safe = name.toString().trim().replace(/\//g, "_");
  if (safe.length > 400) safe = safe.substring(0, 400);
  return safe;
}
function normalizePlate(p){
  return (p || "").toString().toLocaleUpperCase("tr").replace(/\s+/g, "").trim();
}
function escapeHtml(s){ return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g, "&quot;"); }
function setConnStatus(text, ok){
  var el = document.getElementById("connStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "var(--ok)" : "var(--warn)";
}
function on(id, ev, fn){
  var el = document.getElementById(id);
  if (!el){ console.error("[cariTakip] HATA: '" + id + "' bulunamadi (index.html/app.js uyumsuz olabilir)."); return; }
  el.addEventListener(ev, fn);
}

// ---------- Ozel modal (alert/confirm/prompt yerine) ----------

var modalResolve = null;
var modalType = null;

function openCustomModal(type, title, message, placeholder){
  modalType = type;
  document.getElementById("customModalTitle").textContent = title;
  document.getElementById("customModalMessage").textContent = message;
  var input = document.getElementById("customModalInput");
  if (type === "prompt"){
    input.classList.remove("hidden");
    input.value = "";
    input.placeholder = placeholder || "";
    setTimeout(function(){ input.focus(); }, 60);
  } else {
    input.classList.add("hidden");
  }
  document.getElementById("customModalCancelBtn").classList.toggle("hidden", type === "alert");
  document.getElementById("customModalOverlay").classList.add("show");
  return new Promise(function(resolve){ modalResolve = resolve; });
}
function resolveCustomModal(val){
  document.getElementById("customModalOverlay").classList.remove("show");
  if (modalResolve){ var r = modalResolve; modalResolve = null; r(val); }
}
function customAlert(message, title){ return openCustomModal("alert", title || "Bilgi", message); }
function customConfirm(message, title){ return openCustomModal("confirm", title || "Emin misiniz?", message); }
function customPrompt(message, title, placeholder){ return openCustomModal("prompt", title || "Bilgi Girin", message, placeholder); }

function wireCustomModal(){
  on("customModalOkBtn", "click", function(){
    if (modalType === "prompt") resolveCustomModal(document.getElementById("customModalInput").value);
    else resolveCustomModal(true);
  });
  on("customModalCancelBtn", "click", function(){
    resolveCustomModal(modalType === "prompt" ? null : false);
  });
  on("customModalInput", "keydown", function(e){ if (e.key === "Enter") document.getElementById("customModalOkBtn").click(); });
  on("customModalOverlay", "click", function(e){
    if (e.target === this) resolveCustomModal(modalType === "prompt" ? null : false);
  });
}
function soforAdi(plaka){ return soforMap[normalizePlate(plaka)] || ""; }

// ---------- Plaka / meta / sofor konfigurasyonu ----------

function watchPlakaConfig(){
  try {
    plakaDocRef = doc(db, PLAKA_DOC.col, PLAKA_DOC.id);
    onSnapshot(plakaDocRef, function(snap){
      var data = snap.exists() ? snap.data() : {};
      plakaListesi = Array.isArray(data.list) ? data.list.slice() : [];
      plakaListesi.sort(function(a, b){ return a.localeCompare(b, "tr"); });
      populateSalesDropdown();
      renderPlakaManagementList();
      renderSoforList();
      populateAdminFilters();
    }, function(err){ console.error("[cariTakip] plaka config dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] plaka config baglanamadi:", e); }
}

function watchMeta(){
  try {
    metaDocRef = doc(db, META_DOC.col, META_DOC.id);
    onSnapshot(metaDocRef, function(snap){
      var data = snap.exists() ? snap.data() : {};
      lastUploadAt = data.lastUploadAt && data.lastUploadAt.toDate ? data.lastUploadAt.toDate() : null;
      updateVeriTarihiLabel();
      checkNightLock();
    }, function(err){ console.error("[cariTakip] meta dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] meta baglanamadi:", e); }
}

function updateVeriTarihiLabel(){
  var el = document.getElementById("veriTarihiLabel");
  if (!el) return;
  el.textContent = lastUploadAt ? "Veri tarihi: " + fmtTimestamp(lastUploadAt) : "Veri tarihi: -";
}

function watchSofor(){
  try {
    soforDocRef = doc(db, SOFOR_DOC.col, SOFOR_DOC.id);
    onSnapshot(soforDocRef, function(snap){
      soforMap = snap.exists() ? (snap.data() || {}) : {};
      renderSoforList();
      render();
    }, function(err){ console.error("[cariTakip] sofor dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] sofor baglanamadi:", e); }
}

function updateMinBakiyeLabel(){
  var el = document.getElementById("minBakiyeLabel");
  if (el) el.textContent = "Alt limit: " + fmtMoney(minBakiye) + " (bu tutarin altindaki bakiyeler gizleniyor)";
}

function watchAyarlar(){
  try {
    ayarlarDocRef = doc(db, AYARLAR_DOC.col, AYARLAR_DOC.id);
    onSnapshot(ayarlarDocRef, function(snap){
      var data = snap.exists() ? snap.data() : {};
      minBakiye = (typeof data.minBakiye === "number") ? data.minBakiye : 250;
      updateMinBakiyeLabel();
      render();
    }, function(err){ console.error("[cariTakip] ayarlar dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] ayarlar baglanamadi:", e); }
}

function watchSifreler(){
  try {
    sifrelerDocRef = doc(db, SIFRELER_DOC.col, SIFRELER_DOC.id);
    onSnapshot(sifrelerDocRef, function(snap){
      var data = snap.exists() ? snap.data() : {};
      currentSalesPin = data.salesPin || "5678";
    }, function(err){ console.error("[cariTakip] sifreler dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] sifreler baglanamadi:", e); }
}

function watchYoneticiler(){
  try {
    onSnapshot(collection(db, YONETICILER_COLLECTION), function(snap){
      adminUsers = [];
      snap.forEach(function(d){
        var x = d.data();
        adminUsers.push({ id: d.id, name: x.name || d.id, password: x.password || "", isSuper: !!x.isSuper });
      });
      adminUsers.sort(function(a, b){ return a.name.localeCompare(b.name, "tr"); });

      if (!adminUsers.some(function(u){ return u.id === SUPER_ADMIN_ID; })){
        setDoc(doc(db, YONETICILER_COLLECTION, SUPER_ADMIN_ID), { name: "Ercan Şahin", password: "admin123", isSuper: true })
          .catch(function(e){ console.error("[cariTakip] super admin olusturulamadi:", e); });
      }

      populateAdminDropdown();
      renderUserManagementList();
    }, function(err){ console.error("[cariTakip] yoneticiler dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] yoneticiler baglanamadi:", e); }
}

function populateAdminDropdown(){
  var sel = document.getElementById("adminNameSelect");
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">Isim secin...</option>';
  adminUsers.forEach(function(u){
    var o = document.createElement("option");
    o.value = u.id; o.textContent = u.name;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

function renderUserManagementList(){
  var container = document.getElementById("userMgmtList");
  if (!container) return;
  if (adminUsers.length === 0){
    container.innerHTML = '<div class="empty" style="padding:16px;">Henuz yonetici tanimlanmamis.</div>';
    return;
  }
  var html = "";
  adminUsers.forEach(function(u){
    html += '<div class="plaka-item"><span>' + escapeHtml(u.name) + ' — <b>' + escapeHtml(u.password) + '</b></span>';
    if (!u.isSuper) html += '<button type="button" data-uid="' + escapeAttr(u.id) + '">Kaldir</button>';
    html += '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll("button[data-uid]").forEach(function(btn){
    btn.addEventListener("click", async function(){
      var ok = await customConfirm("Bu yoneticiyi kaldirmak istediginize emin misiniz?", "Kaldir");
      if (!ok) return;
      var status = document.getElementById("userMgmtStatus");
      status.textContent = "Kaldiriliyor...";
      try {
        await deleteDoc(doc(db, YONETICILER_COLLECTION, btn.getAttribute("data-uid")));
        status.textContent = "Kaldirildi.";
      } catch (e) {
        status.textContent = "Kaldirilamadi: " + e.message;
      }
    });
  });
}

function dateStr(d){ return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

async function openBasariPanel(){
  document.getElementById("basariOverlay").classList.add("show");
  var body = document.getElementById("basariBody");
  body.innerHTML = '<div class="empty">Hesaplaniyor...</div>';
  try {
    var snap = await getDocs(collection(db, GUNLUK_BAKIYE_COLLECTION));
    var days = [];
    snap.forEach(function(d){ days.push({ date: d.id, data: d.data() || {} }); });
    days.sort(function(a, b){ return b.date.localeCompare(a.date); }); // en yeni once

    if (days.length < 2){
      body.innerHTML = '<div class="empty">Karsilastirma icin en az iki farkli Excel yuklemesi (farkli gunlerde) gerekiyor.</div>';
      return;
    }
    var afterDay = days[0];  // en son yukleme
    var beforeDay = days[1]; // ondan onceki en son yukleme (gun atlansa bile dogru calisir)
    var yData = afterDay.data, bData = beforeDay.data;
    var topPlaka = null, topCollected = -Infinity;
    Object.keys(yData).forEach(function(plaka){
      var before = bData[plaka] || 0;
      var after = yData[plaka];
      var collected = before - after;
      if (collected > topCollected){ topCollected = collected; topPlaka = plaka; }
    });
    var rangeLabel = fmtDateISOtoTR(beforeDay.date) + " - " + fmtDateISOtoTR(afterDay.date);
    if (!topPlaka || topCollected <= 0){
      body.innerHTML = '<div class="empty">' + escapeHtml(rangeLabel) + ' arasinda hicbir plakada net tahsilat olmamis.</div>';
      return;
    }
    var isim = soforAdi(topPlaka);
    var html = '<div class="basari-box">';
    html += '  <div class="trophy">🏆</div>';
    html += '  <div class="plate">' + escapeHtml(topPlaka) + '</div>';
    if (isim) html += '  <div class="sofor">' + escapeHtml(isim) + '</div>';
    html += '  <div class="amount">' + fmtMoney(topCollected) + '</div>';
    html += '  <div class="caption">' + escapeHtml(rangeLabel) + ' arasinda en cok tahsilat yapan plaka</div>';
    html += '</div>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<div class="empty">Hata: ' + escapeHtml(e.message) + '</div>';
  }
}

function populateSalesDropdown(){
  var sel = document.getElementById("salesPlakaSelect");
  if (!sel) return;
  var current = sel.value;
  sel.innerHTML = '<option value="">Plaka secin...</option>';
  plakaListesi.forEach(function(p){
    var opt = document.createElement("option");
    opt.value = p; opt.textContent = p + (soforAdi(p) ? " - " + soforAdi(p) : "");
    sel.appendChild(opt);
  });
  var yokOpt = document.createElement("option");
  yokOpt.value = PLAKA_YOK; yokOpt.textContent = "Plaka Yok";
  sel.appendChild(yokOpt);
  if (current) sel.value = current;
}

async function addPlaka(){
  var input = document.getElementById("newPlakaInput");
  var status = document.getElementById("plakaStatus");
  var val = input.value.trim();
  if (!val){ status.textContent = "Plaka bos olamaz."; return; }
  var norm = normalizePlate(val);
  if (plakaListesi.some(function(p){ return normalizePlate(p) === norm; })){
    status.textContent = "Bu plaka zaten listede."; return;
  }
  status.textContent = "Ekleniyor...";
  try {
    await setDoc(plakaDocRef, { list: arrayUnion(val.toUpperCase().replace(/\s+/g, "")) }, { merge: true });
    input.value = ""; status.textContent = "Eklendi.";
  } catch (e) { status.textContent = "Eklenemedi: " + e.message; }
}
async function removePlaka(plaka){
  var ok = await customConfirm('"' + plaka + '" plakasini kaldirmak istediginize emin misiniz?', "Plaka Sil");
  if (!ok) return;
  var status = document.getElementById("plakaStatus");
  status.textContent = "Kaldiriliyor...";
  try {
    await setDoc(plakaDocRef, { list: arrayRemove(plaka) }, { merge: true });
    status.textContent = "Kaldirildi.";
  } catch (e) { status.textContent = "Kaldirilamadi: " + e.message; }
}
function renderPlakaManagementList(){
  var container = document.getElementById("plakaList");
  if (!container) return;
  if (plakaListesi.length === 0){
    container.innerHTML = '<div class="empty" style="padding:16px;">Henuz plaka eklenmemis.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < plakaListesi.length; i++){
    var p = plakaListesi[i];
    html += '<div class="plaka-item"><span>' + escapeHtml(p) + '</span><button type="button" data-plaka="' + escapeAttr(p) + '">Kaldir</button></div>';
  }
  container.innerHTML = html;
  container.querySelectorAll("button[data-plaka]").forEach(function(btn){
    btn.addEventListener("click", function(){ removePlaka(btn.getAttribute("data-plaka")); });
  });
}

function renderSoforList(){
  var container = document.getElementById("soforList");
  if (!container) return;
  if (plakaListesi.length === 0){
    container.innerHTML = '<div class="empty" style="padding:16px;">Once Plaka Yonetiminden plaka ekleyin.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < plakaListesi.length; i++){
    var p = plakaListesi[i];
    html += '<div class="sofor-item">';
    html += '  <span class="plaka">' + escapeHtml(p) + '</span>';
    html += '  <input type="text" value="' + escapeAttr(soforAdi(p)) + '" data-plaka="' + escapeAttr(p) + '" placeholder="Sofor adi" />';
    html += '  <button type="button" data-plaka="' + escapeAttr(p) + '">Kaydet</button>';
    html += '</div>';
  }
  container.innerHTML = html;
  container.querySelectorAll("button[data-plaka]").forEach(function(btn){
    btn.addEventListener("click", async function(){
      var plaka = btn.getAttribute("data-plaka");
      var input = container.querySelector('input[data-plaka="' + plaka + '"]');
      var status = document.getElementById("soforStatus");
      status.textContent = "Kaydediliyor...";
      try {
        var field = {}; field[normalizePlate(plaka)] = input.value.trim();
        await setDoc(soforDocRef, field, { merge: true });
        status.textContent = "Kaydedildi.";
      } catch (e) { status.textContent = "Kaydedilemedi: " + e.message; }
    });
  });
}

// (renderBasari kaldirildi; artik openBasariPanel kullaniliyor - gunluk kayitlara dayali gercek "dun" karsilastirmasi)

// ---------- Yonetici filtreleri ----------

function populateAdminFilters(){
  var k1sel = document.getElementById("filterKategori1");
  var pksel = document.getElementById("filterPlaka");
  if (!k1sel || !pksel) return;

  var kategori1ler = Array.from(new Set(cariler.map(function(c){ return c.kategori1; }).filter(Boolean))).sort(function(a,b){ return a.localeCompare(b,"tr"); });
  var curK1 = k1sel.value;
  k1sel.innerHTML = '<option value="">Tum Bolgeler</option>';
  kategori1ler.forEach(function(k){ var o = document.createElement("option"); o.value = k; o.textContent = k; k1sel.appendChild(o); });
  if (curK1) k1sel.value = curK1;

  var curPk = pksel.value;
  pksel.innerHTML = '<option value="">Tum Plakalar</option>';
  plakaListesi.forEach(function(p){ var o = document.createElement("option"); o.value = p; o.textContent = p; pksel.appendChild(o); });
  var yokOpt = document.createElement("option"); yokOpt.value = PLAKA_YOK; yokOpt.textContent = "Plaka Yok"; pksel.appendChild(yokOpt);
  if (curPk) pksel.value = curPk;
}

// ---------- Gece kilidi (sadece plasiyer) ----------

function computeLastCutoff(now){
  var cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0, 0);
  if (now.getHours() < 1){ cutoff.setDate(cutoff.getDate() - 1); }
  return cutoff;
}
function checkNightLock(){
  if (currentRole !== "sales") { nightLockActive = false; hideNightLock(); return; }
  if (nightLockBypassed) { nightLockActive = false; hideNightLock(); return; }
  var now = new Date();
  var cutoff = computeLastCutoff(now);
  var locked = !lastUploadAt || lastUploadAt < cutoff;
  nightLockActive = locked;
  if (locked) showNightLock(); else hideNightLock();
}
function showNightLock(){ var el = document.getElementById("nightLock"); if (el) el.classList.add("show"); }
function hideNightLock(){ var el = document.getElementById("nightLock"); if (el) el.classList.remove("show"); }

function openNightBypass(){
  var input = document.getElementById("nightBypassInput");
  input.value = "";
  document.getElementById("nightBypassOverlay").classList.add("show");
  setTimeout(function(){ input.focus(); }, 50);
}
function closeNightBypass(){
  document.getElementById("nightBypassOverlay").classList.remove("show");
}
function wireNightBypass(){
  var title = document.getElementById("nightLockTitle");
  if (title) title.addEventListener("click", openNightBypass);
  on("nightBypassOverlay", "click", function(e){ if (e.target === this) closeNightBypass(); });

  function submitNightBypass(){
    var input = document.getElementById("nightBypassInput");
    if (adminUsers.some(function(u){ return u.password === input.value; })){
      nightLockBypassed = true;
      closeNightBypass();
      checkNightLock();
    } else {
      closeNightBypass();
    }
  }

  on("nightBypassSubmitBtn", "click", submitNightBypass);
  on("nightBypassInput", "keydown", function(e){ if (e.key === "Enter") submitNightBypass(); });
}

// ---------- Rol bazli gorunur liste ----------

function getVisibleCariler(){
  var active = cariler.filter(function(c){ return c.aktif; });
  active = active.filter(function(c){ return (c.debt || 0) >= minBakiye; });
  var base = active;
  if (currentRole === "sales"){
    var wantYok = currentPlakalar.indexOf(PLAKA_YOK) !== -1;
    base = active.filter(function(c){
      if (wantYok) return !c.plaka;
      if (!c.plaka) return false;
      return currentPlakalar.indexOf(normalizePlate(c.plaka)) !== -1;
    });
  } else if (currentRole === "admin"){
    var k1 = document.getElementById("filterKategori1") ? document.getElementById("filterKategori1").value : "";
    var pk = document.getElementById("filterPlaka") ? document.getElementById("filterPlaka").value : "";
    base = active.filter(function(c){
      if (k1 && c.kategori1 !== k1) return false;
      if (pk === PLAKA_YOK && c.plaka) return false;
      if (pk && pk !== PLAKA_YOK && normalizePlate(c.plaka) !== normalizePlate(pk)) return false;
      return true;
    });
  }
  return base;
}

function pendingPaymentsIn(list){
  return list.filter(function(c){ return c.paymentReported && !c.paymentReviewed; });
}

function todayISO(){ return dateStr(new Date()); }

function isDueToday(c){
  // Gorsel vurgu (neon kenarlik) icin: okunma durumundan bagimsiz, sadece tarihe bakar.
  if (!c.due) return false;
  var d = new Date(c.due + "T00:00:00");
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return d <= today;
}
function isDueAlert(c){
  // Bildirim SAYACI (rozet) icin: sadece henuz "okunmamis" olanlari sayar.
  return isDueToday(c) && c.dueReadFor !== c.due;
}
function dueAlertsIn(list){
  return list.filter(function(c){ return isDueToday(c); });
}

function renderDueAlertList(){
  var visible = getVisibleCariler();
  var list = dueAlertsIn(visible).sort(function(a, b){ return new Date(a.due) - new Date(b.due); });
  var container = document.getElementById("dueAlertList");
  if (list.length === 0){
    container.innerHTML = '<div class="empty" style="padding:20px;">Odeme tarihi gelmis cari yok.</div>';
    return;
  }
  var html = "";
  list.forEach(function(c){
    var isRead = c.dueReadFor === c.due;
    html += '<div class="history-item' + (isRead ? " read" : "") + '" data-id="' + escapeAttr(c.id) + '">';
    html += '  <div class="hname">' + escapeHtml(c.name) + '</div>';
    html += '  <div class="hmeta">' + escapeHtml(c.plaka || "Plaka yok") + '</div>';
    html += '  <div class="hnote">Beklenen tarih: ' + escapeHtml(fmtDateISOtoTR(c.due)) + ' | Bakiye: ' + fmtMoney(c.debt) + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;
  container.querySelectorAll(".history-item[data-id]").forEach(function(el){
    el.addEventListener("click", async function(){
      var id = el.getAttribute("data-id");
      var c = cariler.find(function(x){ return x.id === id; });
      if (c && c.dueReadFor !== c.due){
        try { await setDoc(doc(db, CARI_COLLECTION, id), { dueReadFor: c.due }, { merge: true }); }
        catch (e) { console.error("[cariTakip] okundu isaretlenemedi:", e); }
      }
      document.getElementById("dueAlertOverlay").classList.remove("show");
      // cariyi listede bulup gostermek icin arama/hizli-filtreyi temizle, sonra oraya kaydir
      var searchBoxEl = document.getElementById("searchBox");
      if (searchBoxEl.value){
        searchBoxEl.value = "";
        document.getElementById("searchClearBtn").classList.remove("show");
      }
      activeQuickFilter = null;
      render();
      setTimeout(function(){
        var rowEl = document.querySelector('.row[data-id="' + id + '"]');
        if (rowEl) rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    });
  });
}

var activeQuickFilter = null; // null | "flagged" | "noted"

function render(){
  var list = document.getElementById("list");
  var q = document.getElementById("searchBox").value.toLocaleLowerCase("tr").trim();
  var visible = getVisibleCariler();
  var filtered = visible.filter(function(c){ return !q || c.name.toLocaleLowerCase("tr").indexOf(q) !== -1; });
  if (activeQuickFilter === "flagged") filtered = filtered.filter(function(c){ return effFlagged(c); });
  if (activeQuickFilter === "noted") filtered = filtered.filter(function(c){ return !!c.note; });
  if (activeQuickFilter === "duetoday") filtered = filtered.filter(function(c){ return c.due === todayISO(); });

  if (visible.length === 0){
    list.innerHTML = currentRole === "sales"
      ? '<div class="empty">Bu plakaya atanmis cari bulunamadi.</div>'
      : '<div class="empty">Henuz veri yok.<br/>Yukaridan bir Excel dosyasi yukleyin.</div>';
  } else if (filtered.length === 0){
    list.innerHTML = '<div class="empty">Sonuc bulunamadi.</div>';
  } else {
    filtered.sort(function(a, b){ return (b.debt || 0) - (a.debt || 0); });
    var html = "";
    for (var i = 0; i < filtered.length; i++){
      var c = filtered[i];
      var isFlagged = effFlagged(c);
      var cls = isFlagged ? " flagged" : (c.paymentReported ? " paid" : "");
      if (isDueAlert(c)) cls += " due-alert";
      var debtClass = (c.debt || 0) === 0 ? " zero" : "";
      html += '<div class="row' + cls + '" data-id="' + escapeAttr(c.id) + '">';
      html += '  <div class="left">';
      html += '    <div class="name">' + escapeHtml(c.name) + '</div>';
      html += '    <div class="tags">';
      if (c.kategori1) html += '<span class="tag">' + escapeHtml(c.kategori1) + '</span>';
      html += '<span class="tag">' + escapeHtml(c.plaka || "Plaka yok") + '</span>';
      if (c.sonTahTarihi) html += '<span class="tag">Son tahsilat: ' + escapeHtml(c.sonTahTarihi) + '</span>';
      html += '    </div>';
      if (c.sabitNot) html += '    <div class="sabitnot-preview">📌 ' + escapeHtml(c.sabitNot) + '</div>';
      if (c.note) html += '    <div class="note-preview">' + escapeHtml(c.note) + '</div>';
      if (c.due) html += '    <div class="due">Odeme bekleniyor: ' + escapeHtml(fmtDateISOtoTR(c.due)) + '</div>';
      if (c.paymentReported){
        html += '    <div class="paidline">✅ Odeme bildirildi: ' + fmtMoney(c.paymentAmount) + (c.paymentReviewed ? " (onaylandi)" : " (bekliyor)") + '</div>';
      }
      if (c.rejectionReason){
        html += '    <div class="rejectline">⚠️ Reddedildi: ' + escapeHtml(c.rejectionReason) + '</div>';
      }
      if (c.lastEditedBy){
        html += '    <div class="editor" data-editor-id="' + escapeAttr(c.id) + '">Son duzenleyen: ' + escapeHtml(c.lastEditedBy) + (c.lastEditedAtLabel ? " - " + escapeHtml(c.lastEditedAtLabel) : "") + (c.lastAction ? " — " + escapeHtml(c.lastAction) : "") + '</div>';
      }
      html += '  </div>';
      html += '  <div class="right">';
      html += '    <div class="debt' + debtClass + '">' + fmtMoney(c.debt) + '</div>';
      if (isFlagged) html += '    <div class="badgetxt">' + (c.flagged ? "SORUNLU" : "SORUNLU (" + AUTO_FLAG_DAYS + "+ gun)") + '</div>';
      html += '  </div>';
      html += '</div>';
    }
    list.innerHTML = html;
    list.querySelectorAll(".row").forEach(function(row){
      row.addEventListener("click", function(){ openDetail(row.getAttribute("data-id")); });
    });
    list.querySelectorAll(".editor[data-editor-id]").forEach(function(el){
      el.addEventListener("click", function(e){
        e.stopPropagation();
        showChangeDetail(el.getAttribute("data-editor-id"));
      });
    });
  }

  document.getElementById("cariCountLabel").textContent = "(" + visible.length + ")";
  document.getElementById("sumNoted").textContent = visible.filter(function(c){ return !!c.note; }).length;
  document.getElementById("sumDebt").textContent = fmtMoney(visible.reduce(function(s, c){ return s + (c.debt || 0); }, 0));
  document.getElementById("sumFlag").textContent = visible.filter(function(c){ return effFlagged(c); }).length;
  document.getElementById("sumDueToday").textContent = visible.filter(function(c){ return c.due === todayISO(); }).length;

  document.getElementById("chipNoted").classList.toggle("active", activeQuickFilter === "noted");
  document.getElementById("chipFlag").classList.toggle("active", activeQuickFilter === "flagged");
  document.getElementById("chipDueToday").classList.toggle("active", activeQuickFilter === "duetoday");

  var pendingCount = pendingPaymentsIn(visible).length;
  var badge = document.getElementById("paymentBadge");
  if (pendingCount > 0){ badge.textContent = pendingCount; badge.classList.remove("hidden"); }
  else { badge.classList.add("hidden"); }

  var dueAlertCount = visible.filter(function(c){ return isDueAlert(c); }).length;
  var dueBadge = document.getElementById("dueAlertBadge");
  if (dueAlertCount > 0){ dueBadge.textContent = dueAlertCount; dueBadge.classList.remove("hidden"); }
  else { dueBadge.classList.add("hidden"); }

  if (currentRole === "admin"){
    var k1val = document.getElementById("filterKategori1").value;
    var pkval = document.getElementById("filterPlaka").value;
    document.getElementById("clearKategori1Btn").classList.toggle("show", !!k1val);
    document.getElementById("clearPlakaBtn").classList.toggle("show", !!pkval);
    document.getElementById("clearAllFiltersBtn").classList.toggle("show", !!k1val || !!pkval);
  }
}

// ---------- Ozel takvim ----------

function pad2(n){ return n < 10 ? "0" + n : "" + n; }
function isoFor(y, m, d){ return y + "-" + pad2(m + 1) + "-" + pad2(d); }
var TR_MONTHS = ["Ocak","Subat","Mart","Nisan","Mayis","Haziran","Temmuz","Agustos","Eylul","Ekim","Kasim","Aralik"];

function renderCalendar(){
  document.getElementById("calMonthLabel").textContent = TR_MONTHS[calViewMonth] + " " + calViewYear;
  var grid = document.getElementById("calGrid");
  grid.innerHTML = "";
  var firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  var startWeekday = (firstOfMonth.getDay() + 6) % 7;
  var daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  var today = new Date();
  var todayISO = isoFor(today.getFullYear(), today.getMonth(), today.getDate());
  for (var i = 0; i < startWeekday; i++){ var e = document.createElement("div"); e.className = "empty"; grid.appendChild(e); }
  for (var d = 1; d <= daysInMonth; d++){
    var cell = document.createElement("div");
    cell.textContent = d;
    var iso = isoFor(calViewYear, calViewMonth, d);
    if (iso === todayISO) cell.classList.add("today");
    if (iso === calSelectedISO) cell.classList.add("selected");
    cell.addEventListener("click", (function(iso){ return function(){
      calSelectedISO = iso;
      document.getElementById("dueInput").value = iso;
      document.getElementById("dueDisplay").textContent = fmtDateISOtoTR(iso);
      document.getElementById("dueDisplay").classList.remove("placeholder");
      closeCalendar();
    };})(iso));
    grid.appendChild(cell);
  }
}
function openCalendar(){
  var iso = document.getElementById("dueInput").value;
  var base = iso ? new Date(iso + "T00:00:00") : new Date();
  calViewYear = base.getFullYear(); calViewMonth = base.getMonth(); calSelectedISO = iso || "";
  renderCalendar();
  document.getElementById("calendarPopup").classList.add("show");
}
function closeCalendar(){ document.getElementById("calendarPopup").classList.remove("show"); }
function wireCalendar(){
  on("dueFieldBtn", "click", function(e){
    e.stopPropagation();
    var popup = document.getElementById("calendarPopup");
    if (popup.classList.contains("show")) closeCalendar(); else openCalendar();
  });
  on("calPrev", "click", function(e){ e.stopPropagation(); calViewMonth--; if (calViewMonth < 0){ calViewMonth = 11; calViewYear--; } renderCalendar(); });
  on("calNext", "click", function(e){ e.stopPropagation(); calViewMonth++; if (calViewMonth > 11){ calViewMonth = 0; calViewYear++; } renderCalendar(); });
  on("calToday", "click", function(e){
    e.stopPropagation();
    var t = new Date(); var iso = isoFor(t.getFullYear(), t.getMonth(), t.getDate());
    calSelectedISO = iso;
    document.getElementById("dueInput").value = iso;
    document.getElementById("dueDisplay").textContent = fmtDateISOtoTR(iso);
    document.getElementById("dueDisplay").classList.remove("placeholder");
    closeCalendar();
  });
  on("calClear", "click", function(e){
    e.stopPropagation();
    calSelectedISO = "";
    document.getElementById("dueInput").value = "";
    document.getElementById("dueDisplay").textContent = "Tarih secilmedi";
    document.getElementById("dueDisplay").classList.add("placeholder");
    closeCalendar();
  });
  document.addEventListener("click", function(e){
    var popup = document.getElementById("calendarPopup");
    var btn = document.getElementById("dueFieldBtn");
    if (popup && btn && !popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeCalendar();
  });
}

// ---------- Detay paneli ----------

function openDetail(id){
  if (nightLockActive) return;
  currentDocId = id;
  var c = cariler.find(function(x){ return x.id === id; });
  if (!c) return;

  document.getElementById("detailName").textContent = c.name;
  var editorText = c.lastEditedBy
    ? "Son duzenleyen: " + c.lastEditedBy + (c.lastEditedAtLabel ? " - " + c.lastEditedAtLabel : "")
    : "Henuz kimse duzenlemedi.";
  if (c.lastAction) editorText += " — " + c.lastAction;
  if (c.rejectionReason) editorText += " | ⚠️ Reddedildi: " + c.rejectionReason;
  if (!c.flagged && isAutoFlagged(c)){
    var ds = daysSinceCollection(c);
    editorText += " | ⚠️ Otomatik sorunlu: " + (ds === null ? "hic tahsilat yok" : ds + " gundur tahsilat yok");
  }
  document.getElementById("detailEditor").textContent = editorText;

  var metaParts = [];
  if (c.kategori1) metaParts.push("Bolge: " + c.kategori1);
  metaParts.push("Plaka: " + (c.plaka || "Yok"));
  if (c.sonTahTarihi) metaParts.push("Son Tahsilat: " + c.sonTahTarihi);
  document.getElementById("detailMeta").textContent = metaParts.join(" | ");

  document.getElementById("debtInput").value = fmtMoney(c.debt || 0);
  document.getElementById("sabitNotInput").value = c.sabitNot || "";
  document.getElementById("noteInput").value = c.note || "";

  var iso = c.due || "";
  document.getElementById("dueInput").value = iso;
  var dd = document.getElementById("dueDisplay");
  if (iso){ dd.textContent = fmtDateISOtoTR(iso); dd.classList.remove("placeholder"); }
  else { dd.textContent = "Tarih secilmedi"; dd.classList.add("placeholder"); }

  document.getElementById("flagSwitch").classList.toggle("on", !!c.flagged);

  var paidSw = document.getElementById("paidSwitch");
  paidSw.classList.toggle("on", !!c.paymentReported);
  paidSw.classList.toggle("paidsw", !!c.paymentReported);
  document.getElementById("paidAmountInput").value = c.paymentAmount ? fmtMoney(c.paymentAmount) : "";
  document.getElementById("paidAmountRow").classList.toggle("show", !!c.paymentReported);

  document.getElementById("saveStatus").textContent = "";
  document.getElementById("overlay").classList.add("show");
}
function closeDetail(){
  closeCalendar();
  document.getElementById("overlay").classList.remove("show");
  currentDocId = null;
}
function editorLabel(){
  if (currentRole === "admin") return currentUserName + " (yonetici)";
  var plaka = currentPlakalar[0] || "?";
  var isim = soforAdi(plaka);
  return plaka + (isim ? " - " + isim : "") + " (plasiyer)";
}

function computeChangeLines(before, after){
  var lines = [];
  var beforeNote = (before && before.note) || "";
  var afterNote = after.note || "";
  if (beforeNote !== afterNote){
    if (!beforeNote && afterNote) lines.push('Gecici not eklendi: "' + afterNote + '"');
    else if (beforeNote && !afterNote) lines.push('Gecici not silindi (onceki: "' + beforeNote + '")');
    else lines.push('Gecici not degistirildi: "' + beforeNote + '" -> "' + afterNote + '"');
  }
  var beforeSabit = (before && before.sabitNot) || "";
  var afterSabit = after.sabitNot || "";
  if (beforeSabit !== afterSabit){
    if (!beforeSabit && afterSabit) lines.push('Sabit not eklendi: "' + afterSabit + '"');
    else if (beforeSabit && !afterSabit) lines.push('Sabit not silindi (onceki: "' + beforeSabit + '")');
    else lines.push('Sabit not degistirildi: "' + beforeSabit + '" -> "' + afterSabit + '"');
  }
  var beforeDue = (before && before.due) || "";
  var afterDue = after.due || "";
  if (beforeDue !== afterDue){
    if (!beforeDue && afterDue) lines.push("Odeme tarihi eklendi: " + fmtDateISOtoTR(afterDue));
    else if (beforeDue && !afterDue) lines.push("Odeme tarihi silindi (onceki: " + fmtDateISOtoTR(beforeDue) + ")");
    else lines.push("Odeme tarihi degistirildi: " + fmtDateISOtoTR(beforeDue) + " -> " + fmtDateISOtoTR(afterDue));
  }
  var beforeFlag = !!(before && before.flagged);
  var afterFlag = !!after.flagged;
  if (beforeFlag !== afterFlag) lines.push(afterFlag ? "Sorunlu isareti acildi" : "Sorunlu isareti kapatildi");

  var beforeDebt = (before && before.debt) || 0;
  var afterDebt = after.debt || 0;
  if (Math.abs(beforeDebt - afterDebt) > 0.001) lines.push("Bakiye guncellendi: " + fmtMoney(beforeDebt) + " -> " + fmtMoney(afterDebt));

  var beforePaid = !!(before && before.paymentReported);
  var afterPaid = !!after.paymentReported;
  if (!beforePaid && afterPaid) lines.push("Odeme bildirildi: " + fmtMoney(after.paymentAmount || 0));
  else if (beforePaid && !afterPaid) lines.push("Odeme bildirimi kaldirildi");

  return lines;
}

function showChangeDetail(id){
  var c = cariler.find(function(x){ return x.id === id; });
  if (!c) return;
  var lines = [];
  lines.push("Kim: " + (c.lastEditedBy || "-"));
  lines.push("Ne zaman: " + (c.lastEditedAtLabel || "-"));
  lines.push("Islem: " + (c.lastAction || "-"));
  if (c.lastChangeDetail){ lines.push(""); lines.push(c.lastChangeDetail); }
  if (c.rejectionReason){ lines.push(""); lines.push("Red sebebi: " + c.rejectionReason); }
  customAlert(lines.join("\n"), c.name + " - Son Degisiklik");
}

async function writeHistory(c, data){
  try {
    var histRef = doc(collection(db, HISTORY_COLLECTION));
    await setDoc(histRef, {
      cariId: c.id, cariName: c.name, plaka: c.plaka || "",
      note: data.note, sabitNot: data.sabitNot || "", due: data.due, flagged: data.flagged, debt: data.debt,
      paymentReported: data.paymentReported, paymentAmount: data.paymentAmount || 0,
      editedBy: data.lastEditedBy, editedAt: serverTimestamp()
    });
  } catch (e) { console.error("[cariTakip] gecmis kaydi yazilamadi:", e); }
}

async function clearCurrentDetail(){
  if (!currentDocId) return;
  var ok = await customConfirm("Bu carinin notu, tarihi, sorunlu isareti ve odeme bildirimi tamamen temizlensin mi? Isim/kategori/plaka/bakiye bilgisi degismez.", "Temizle");
  if (!ok) return;
  var c = cariler.find(function(x){ return x.id === currentDocId; });
  var status = document.getElementById("saveStatus");
  status.textContent = "Temizleniyor...";
  var detail = "Yonetici tarafindan tum kayit temizlendi.";
  if (c && c.note) detail += '\nSilinen not: "' + c.note + '"';
  if (c && c.due) detail += "\nSilinen tarih: " + fmtDateISOtoTR(c.due);
  try {
    await setDoc(doc(db, CARI_COLLECTION, currentDocId), {
      note: "", due: "", flagged: false,
      paymentReported: false, paymentAmount: 0, paymentReviewed: false, paymentReportedBy: "", rejectionReason: "",
      lastAction: "Kayit temizlendi (yonetici)",
      lastChangeDetail: detail,
      lastEditedBy: editorLabel(), lastEditedAt: serverTimestamp()
    }, { merge: true });
    status.textContent = "Temizlendi.";
    setTimeout(closeDetail, 400);
  } catch (e) {
    status.textContent = "Temizlenemedi: " + e.message;
  }
}

async function saveCurrentNote(){
  if (!currentDocId) return;
  var status = document.getElementById("saveStatus");
  var c = cariler.find(function(x){ return x.id === currentDocId; });
  var debtVal = parseNumber(document.getElementById("debtInput").value);
  if (isNaN(debtVal)) debtVal = 0;

  var paid = document.getElementById("paidSwitch").classList.contains("on");
  var paidAmount = parseNumber(document.getElementById("paidAmountInput").value);
  if (isNaN(paidAmount)) paidAmount = 0;

  var newValues = {
    debt: debtVal,
    note: document.getElementById("noteInput").value,
    sabitNot: document.getElementById("sabitNotInput").value,
    due: document.getElementById("dueInput").value,
    flagged: document.getElementById("flagSwitch").classList.contains("on"),
    paymentReported: paid,
    paymentAmount: paid ? paidAmount : 0
  };

  var changeLines = computeChangeLines(c, newValues);
  if (changeLines.length === 0){
    status.textContent = "Degisiklik yok, kaydedilmedi.";
    setTimeout(closeDetail, 500);
    return;
  }

  var data = {
    debt: newValues.debt,
    note: newValues.note,
    sabitNot: newValues.sabitNot,
    due: newValues.due,
    flagged: newValues.flagged,
    paymentReported: newValues.paymentReported,
    paymentAmount: newValues.paymentAmount,
    lastChangeDetail: changeLines.join("\n"),
    lastEditedBy: editorLabel(),
    updatedAt: serverTimestamp(),
    lastEditedAt: serverTimestamp()
  };
  if (paid && !(c && c.paymentReported)){
    data.paymentReportedBy = editorLabel();
    data.paymentReportedAt = serverTimestamp();
    data.paymentReviewed = false;
    data.rejectionReason = ""; // yeni bildirim eski red notunu temizler
    data.lastAction = "Odeme bildirildi: " + fmtMoney(paidAmount);
  } else if (!paid && c && c.paymentReported){
    data.paymentReviewed = false;
    data.paymentReportedBy = "";
    data.lastAction = "Odeme bildirimi kaldirildi";
  } else {
    data.lastAction = "Bilgi guncellendi";
  }

  status.textContent = "Kaydediliyor...";
  try {
    await setDoc(doc(db, CARI_COLLECTION, currentDocId), data, { merge: true });
    if (c) await writeHistory(c, data);
    status.textContent = "Kaydedildi.";
    setTimeout(closeDetail, 400);
  } catch (e) {
    status.textContent = "Kaydedilemedi: " + e.message;
  }
}

// ---------- Odeme bildirimleri paneli (onayla / reddet / notu temizle / iptal) ----------

function renderPaymentList(){
  var visible = getVisibleCariler();
  var pending = pendingPaymentsIn(visible);
  var container = document.getElementById("paymentList");
  if (pending.length === 0){
    container.innerHTML = '<div class="empty" style="padding:20px;">Onay bekleyen odeme bildirimi yok.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < pending.length; i++){
    var c = pending[i];
    html += '<div class="review-item" data-id="' + escapeAttr(c.id) + '">';
    html += '  <div class="rname">' + escapeHtml(c.name) + '</div>';
    html += '  <div class="rmeta">Bildiren: ' + escapeHtml(c.paymentReportedBy || "-") + ' | Guncel bakiye: ' + fmtMoney(c.debt) + '</div>';
    html += '  <div class="ramount">Bildirilen odeme: ' + fmtMoney(c.paymentAmount) + '</div>';
    if (c.note){
      html += '  <div class="rmeta" style="color:var(--danger);margin-top:4px;">Plasiyer notu: "' + escapeHtml(c.note) + '"</div>';
    }
    html += '  <div class="ractions">';
    if (currentRole === "admin"){
      html += '<button type="button" class="approve" data-act="approve">Onayla</button>';
      html += '<button type="button" class="reject" data-act="reject">Reddet</button>';
    } else {
      html += '<button type="button" class="cancel" data-act="cancel">Bildirimi Iptal Et</button>';
    }
    html += '  </div>';
    html += '</div>';
  }
  container.innerHTML = html;
  container.querySelectorAll(".review-item").forEach(function(item){
    var id = item.getAttribute("data-id");
    item.querySelectorAll("button[data-act]").forEach(function(btn){
      btn.addEventListener("click", function(){ handlePaymentAction(id, btn.getAttribute("data-act")); });
    });
  });
}

async function handlePaymentAction(id, action){
  var status = document.getElementById("paymentStatus");
  var c = cariler.find(function(x){ return x.id === id; });
  try {
    if (action === "approve"){
      status.textContent = "Isleniyor...";
      // Odeme onaylaninca not/tarih/sorunlu bilgisi de temizlenir -- eski borc notu
      // yeni bir odeme bekleniyormus gibi yanlis izlenim vermesin diye.
      var approveDetail = "Odeme onaylandi (bildirilen tutar: " + fmtMoney(c ? c.paymentAmount : 0) + ").";
      if (c && c.note) approveDetail += '\nTemizlenen not: "' + c.note + '"';
      if (c && c.due) approveDetail += "\nTemizlenen tarih: " + fmtDateISOtoTR(c.due);
      await setDoc(doc(db, CARI_COLLECTION, id), {
        note: "", due: "", flagged: false,
        paymentReported: false, paymentAmount: 0, paymentReviewed: true, paymentReportedBy: "", rejectionReason: "",
        lastAction: "Odeme onaylandi, not temizlendi",
        lastChangeDetail: approveDetail,
        lastEditedBy: editorLabel(), lastEditedAt: serverTimestamp()
      }, { merge: true });
      status.textContent = "Onaylandi, not temizlendi.";
    } else if (action === "reject"){
      var reason = await customPrompt("Reddetme sebebini yazin:", "Odeme Reddi", "Orn: Odeme yetersiz, yarin POS cektir");
      if (reason === null) return;
      if (!reason.trim()){ await customAlert("Sebep girmeden reddedemezsiniz.", "Uyari"); return; }
      status.textContent = "Isleniyor...";
      var rejectDetail = "Odeme reddedildi (bildirilen tutar: " + fmtMoney(c ? c.paymentAmount : 0) + ").\nSebep: " + reason.trim();
      await setDoc(doc(db, CARI_COLLECTION, id), {
        paymentReported: false, paymentAmount: 0, paymentReviewed: false, paymentReportedBy: "",
        rejectionReason: reason.trim(), rejectedBy: editorLabel(), rejectedAt: serverTimestamp(),
        lastAction: "Odeme reddedildi",
        lastChangeDetail: rejectDetail,
        lastEditedBy: editorLabel(), lastEditedAt: serverTimestamp()
      }, { merge: true });
      status.textContent = "Reddedildi.";
    } else if (action === "cancel"){
      status.textContent = "Isleniyor...";
      var cancelDetail = "Plasiyer kendi bildirdigi odeme bildirimini iptal etti (bildirilen tutar: " + fmtMoney(c ? c.paymentAmount : 0) + ").";
      await setDoc(doc(db, CARI_COLLECTION, id), {
        paymentReported: false, paymentAmount: 0, paymentReviewed: false, paymentReportedBy: "",
        lastAction: "Odeme bildirimi iptal edildi",
        lastChangeDetail: cancelDetail,
        lastEditedBy: editorLabel(), lastEditedAt: serverTimestamp()
      }, { merge: true });
      status.textContent = "Iptal edildi.";
    }
  } catch (e) {
    status.textContent = "Islenemedi: " + e.message;
  }
}

// ---------- Gecmis paneli ----------

var historyEntries = [];

function watchHistory(){
  if (unsubHistory) unsubHistory();
  try {
    var q = query(collection(db, HISTORY_COLLECTION), orderBy("editedAt", "desc"), limit(200));
    unsubHistory = onSnapshot(q, function(snap){
      historyEntries = [];
      snap.forEach(function(d){
        var x = d.data();
        historyEntries.push({
          cariName: x.cariName || "", note: x.note || "", due: x.due || "",
          debt: x.debt || 0, editedBy: x.editedBy || "", editedAtLabel: fmtTimestamp(x.editedAt)
        });
      });
      if (!document.getElementById("historyOverlay").classList.contains("show")) return;
      renderHistoryList();
    }, function(err){ console.error("[cariTakip] gecmis dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] gecmis baglanamadi:", e); }
}

function renderHistoryList(){
  var q = document.getElementById("historySearch").value.toLocaleLowerCase("tr").trim();
  var filtered = historyEntries.filter(function(h){ return !q || h.cariName.toLocaleLowerCase("tr").indexOf(q) !== -1; });
  var container = document.getElementById("historyList");
  if (filtered.length === 0){
    container.innerHTML = '<div class="empty" style="padding:20px;">Kayit bulunamadi.</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < filtered.length; i++){
    var h = filtered[i];
    html += '<div class="history-item">';
    html += '  <div class="hname">' + escapeHtml(h.cariName) + '</div>';
    html += '  <div class="hmeta">' + escapeHtml(h.editedBy) + ' - ' + escapeHtml(h.editedAtLabel) + '</div>';
    if (h.note) html += '  <div class="hnote">"' + escapeHtml(h.note) + '"</div>';
    if (h.due) html += '  <div class="hnote">Beklenen tarih: ' + escapeHtml(fmtDateISOtoTR(h.due)) + '</div>';
    html += '  <div class="hnote">Bakiye: ' + fmtMoney(h.debt) + '</div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

// ---------- Tahsilat Durumu (gecikmis cariler) ----------

function parseTRDate(s){
  if (!s) return null;
  var parts = s.toString().split(".");
  if (parts.length !== 3) return null;
  var d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
  if (!d || !m || !y) return null;
  var dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}
function daysBetween(a, b){ return Math.floor((b - a) / (1000 * 60 * 60 * 24)); }
var AUTO_FLAG_DAYS = 90; // bu kadar gundur tahsilat yoksa otomatik "sorunlu" sayilir
function daysSinceCollection(c){
  var d = parseTRDate(c.sonTahTarihi);
  if (!d) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return daysBetween(d, today);
}
function isAutoFlagged(c){
  if (!c.sonTahTarihi) return true; // hic tahsilat tarihi yok -- otomatik sorunlu
  var days = daysSinceCollection(c);
  return days !== null && days >= AUTO_FLAG_DAYS;
}
function effFlagged(c){ return !!c.flagged || isAutoFlagged(c); }

var activeAgingMode = null; // "custom" | "1ay" | "2ay" | "3ay" | "3ayustu"

function computeAgingList(mode, customDays){
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var visible = getVisibleCariler();
  return visible.filter(function(c){
    var d = parseTRDate(c.sonTahTarihi);
    if (!d){
      // hic tahsilat tarihi girilmemis -- gun sayisi filtresinde ve "3 aydan fazla" grubunda gosterilir
      return mode === "custom" || mode === "3ayustu";
    }
    var diff = daysBetween(d, today);
    if (mode === "custom") return diff >= customDays;
    if (mode === "1ay") return diff >= 30 && diff < 60;
    if (mode === "2ay") return diff >= 60 && diff < 90;
    if (mode === "3ay") return diff >= 90 && diff < 120;
    if (mode === "3ayustu") return diff >= 120;
    return false;
  }).sort(function(a, b){
    var da = parseTRDate(a.sonTahTarihi), db = parseTRDate(b.sonTahTarihi);
    if (!da && !db) return 0;
    if (!da) return -1;
    if (!db) return 1;
    return da - db;
  });
}

function renderAgingResults(list){
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var container = document.getElementById("tahsilatResults");
  if (list.length === 0){
    container.innerHTML = '<div class="empty" style="padding:20px;">Bu kritere uyan cari bulunamadi.</div>';
    return;
  }
  var html = "";
  list.forEach(function(c){
    var d = parseTRDate(c.sonTahTarihi);
    var daysTxt = d ? (daysBetween(d, today) + " gun once") : "Hic tahsilat yok";
    html += '<div class="history-item">';
    html += '  <div class="hname">' + escapeHtml(c.name) + '</div>';
    html += '  <div class="hmeta">' + escapeHtml(c.plaka || "Plaka yok") + ' | Son tahsilat: ' + escapeHtml(c.sonTahTarihi || "-") + ' (' + daysTxt + ')</div>';
    html += '  <div class="hnote">Bakiye: ' + fmtMoney(c.debt) + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;
}

function setAgingTabActive(id){
  ["tabGunSayisi", "tab1Ay", "tab2Ay", "tab3Ay", "tab3AyUstu"].forEach(function(tid){
    document.getElementById(tid).classList.toggle("active", tid === id);
  });
}

function activeFilterNotice(){
  if (currentRole !== "admin") return "";
  var k1 = document.getElementById("filterKategori1") ? document.getElementById("filterKategori1").value : "";
  var pk = document.getElementById("filterPlaka") ? document.getElementById("filterPlaka").value : "";
  if (!k1 && !pk) return "";
  var parts = [];
  if (k1) parts.push("Bolge=" + k1);
  if (pk) parts.push("Plaka=" + (pk === PLAKA_YOK ? "Plaka Yok" : pk));
  return "⚠️ Ana ekrandaki filtre uygulaniyor: " + parts.join(", ") + ". Tum carileri gormek icin ana ekrandaki filtreyi temizleyin.";
}

function openTahsilatPanel(){
  document.getElementById("gunSayisiRow").classList.remove("show");
  document.getElementById("tahsilatResults").innerHTML = '<div class="empty" style="padding:20px;">Yukaridan bir kriter secin.</div>';
  document.getElementById("tahsilatFilterNotice").textContent = activeFilterNotice();
  setAgingTabActive(null);
  activeAgingMode = null;
  document.getElementById("tahsilatOverlay").classList.add("show");
}

function wireTahsilatPanel(){
  on("closeTahsilatBtn", "click", function(){ document.getElementById("tahsilatOverlay").classList.remove("show"); });
  on("tahsilatOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });

  on("tabGunSayisi", "click", function(){
    setAgingTabActive("tabGunSayisi");
    document.getElementById("gunSayisiRow").classList.add("show");
  });
  on("tab1Ay", "click", function(){ setAgingTabActive("tab1Ay"); document.getElementById("gunSayisiRow").classList.remove("show"); renderAgingResults(computeAgingList("1ay")); });
  on("tab2Ay", "click", function(){ setAgingTabActive("tab2Ay"); document.getElementById("gunSayisiRow").classList.remove("show"); renderAgingResults(computeAgingList("2ay")); });
  on("tab3Ay", "click", function(){ setAgingTabActive("tab3Ay"); document.getElementById("gunSayisiRow").classList.remove("show"); renderAgingResults(computeAgingList("3ay")); });
  on("tab3AyUstu", "click", function(){ setAgingTabActive("tab3AyUstu"); document.getElementById("gunSayisiRow").classList.remove("show"); renderAgingResults(computeAgingList("3ayustu")); });

  on("gunSayisiGosterBtn", "click", function(){
    var val = parseInt(document.getElementById("gunSayisiInput").value, 10);
    if (isNaN(val) || val < 0){ customAlert("Gecerli bir gun sayisi girin.", "Uyari"); return; }
    renderAgingResults(computeAgingList("custom", val));
  });
}

// ---------- Odeme Bekleyenler ----------

var activeOdemeSort = "date";

function renderOdemeBekleyen(){
  var visible = getVisibleCariler();
  var list = visible.filter(function(c){ return !!c.due; });
  if (activeOdemeSort === "debt"){
    list.sort(function(a, b){ return (b.debt || 0) - (a.debt || 0); });
  } else {
    list.sort(function(a, b){ return new Date(a.due) - new Date(b.due); });
  }
  var container = document.getElementById("odemeBekleyenResults");
  if (list.length === 0){
    container.innerHTML = '<div class="empty" style="padding:20px;">Odeme beklenen cari yok.</div>';
    return;
  }
  var html = "";
  list.forEach(function(c){
    html += '<div class="history-item">';
    html += '  <div class="hname">' + escapeHtml(c.name) + '</div>';
    html += '  <div class="hmeta">' + escapeHtml(c.plaka || "Plaka yok") + ' | Beklenen tarih: ' + escapeHtml(fmtDateISOtoTR(c.due)) + '</div>';
    html += '  <div class="hnote">Bakiye: ' + fmtMoney(c.debt) + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;
}

function setOdemeTabActive(id){
  ["tabSortDate", "tabSortDebt"].forEach(function(tid){
    document.getElementById(tid).classList.toggle("active", tid === id);
  });
}

function openOdemeBekleyenPanel(){
  activeOdemeSort = "date";
  setOdemeTabActive("tabSortDate");
  document.getElementById("odemeFilterNotice").textContent = activeFilterNotice();
  renderOdemeBekleyen();
  document.getElementById("odemeBekleyenOverlay").classList.add("show");
}

function wireOdemeBekleyenPanel(){
  on("closeOdemeBekleyenBtn", "click", function(){ document.getElementById("odemeBekleyenOverlay").classList.remove("show"); });
  on("odemeBekleyenOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });
  on("tabSortDate", "click", function(){ activeOdemeSort = "date"; setOdemeTabActive("tabSortDate"); renderOdemeBekleyen(); });
  on("tabSortDebt", "click", function(){ activeOdemeSort = "debt"; setOdemeTabActive("tabSortDebt"); renderOdemeBekleyen(); });
}

// ---------- Tahsilat Trendi (tarih araligina gore gunluk net tahsilat) ----------

async function loadTrendData(startStr, endStr){
  var snap = await getDocs(collection(db, GUNLUK_BAKIYE_COLLECTION));
  var byDate = {};
  snap.forEach(function(d){
    var data = d.data() || {};
    var total = Object.keys(data).reduce(function(s, k){ return s + (data[k] || 0); }, 0);
    byDate[d.id] = total;
  });

  var start = new Date(startStr + "T00:00:00");
  var end = new Date(endStr + "T00:00:00");

  // baslangictan hemen onceki bilinen toplami bul (ilk gunun farkini hesaplayabilmek icin)
  var prevTotal = null;
  var cursor = new Date(start); cursor.setDate(cursor.getDate() - 1);
  for (var back = 0; back < 60; back++){
    var ds = dateStr(cursor);
    if (byDate.hasOwnProperty(ds)){ prevTotal = byDate[ds]; break; }
    cursor.setDate(cursor.getDate() - 1);
  }

  var series = [];
  var d2 = new Date(start);
  while (d2 <= end){
    var ds2 = dateStr(d2);
    var total = byDate.hasOwnProperty(ds2) ? byDate[ds2] : prevTotal;
    var collected = (prevTotal !== null && total !== null) ? (prevTotal - total) : null;
    series.push({ date: ds2, collected: collected });
    if (total !== null) prevTotal = total;
    d2.setDate(d2.getDate() + 1);
  }
  return series;
}

function renderTrendChart(series){
  var container = document.getElementById("trendChartArea");
  var validPoints = series.filter(function(p){ return p.collected !== null; });
  if (validPoints.length === 0){
    container.innerHTML = '<div class="empty">Bu tarih araligi icin yeterli veri yok.<br/>En az iki ardisik gunluk Excel yuklemesi gerekiyor.</div>';
    return;
  }
  var maxAbs = Math.max.apply(null, validPoints.map(function(p){ return Math.abs(p.collected); }).concat([1]));
  var html = '<div class="trend-bars">';
  series.forEach(function(p){
    var pct = p.collected === null ? 0 : Math.max(Math.round((Math.abs(p.collected) / maxAbs) * 100), 3);
    var isNeg = p.collected !== null && p.collected < 0;
    var barClass = "trend-bar " + (isNeg ? "neg" : "pos");
    var valTxt = p.collected === null ? "-" : fmtMoney(p.collected);
    html += '<div class="trend-col">';
    html += '  <div class="trend-val">' + escapeHtml(valTxt) + '</div>';
    html += '  <div class="trend-bar-wrap">' + (p.collected === null ? "" : '<div class="' + barClass + '" style="height:' + pct + '%"></div>') + '</div>';
    html += '  <div class="trend-label">' + escapeHtml(fmtDateISOtoTR(p.date).substring(0, 5)) + '</div>';
    html += '</div>';
  });
  html += '</div>';

  var totalCollected = validPoints.reduce(function(s, p){ return s + p.collected; }, 0);
  html += '<div class="trend-summary">Secili aralikta net tahsilat: <b>' + fmtMoney(totalCollected) + '</b></div>';
  container.innerHTML = html;
}

async function loadAndRenderTrend(){
  var startStr = document.getElementById("trendStartDate").value;
  var endStr = document.getElementById("trendEndDate").value;
  if (!startStr || !endStr || startStr > endStr){
    await customAlert("Gecerli bir tarih araligi secin (baslangic, bitisten once veya ayni gun olmali).", "Uyari");
    return;
  }
  document.getElementById("trendChartArea").innerHTML = '<div class="empty">Yukleniyor...</div>';
  try {
    var series = await loadTrendData(startStr, endStr);
    renderTrendChart(series);
  } catch (e) {
    document.getElementById("trendChartArea").innerHTML = '<div class="empty">Hata: ' + escapeHtml(e.message) + '</div>';
  }
}

function openTrendPanel(){
  var today = new Date();
  var start = new Date(today); start.setDate(today.getDate() - 6);
  document.getElementById("trendStartDate").value = dateStr(start);
  document.getElementById("trendEndDate").value = dateStr(today);
  document.getElementById("trendOverlay").classList.add("show");
  loadAndRenderTrend();
}

function wireTrendPanel(){
  on("closeTrendBtn", "click", function(){ document.getElementById("trendOverlay").classList.remove("show"); });
  on("trendOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });
  on("trendGosterBtn", "click", loadAndRenderTrend);
}

// ---------- Excel yukleme (sadece yonetici) ----------

function requiredColumnsText(){
  return "Gerekli kolonlar: " + REQUIRED_COLUMNS.map(function(c){ return c.label; }).join(", ");
}

// ---------- Yukleme modali ----------

function showUploadModal(){
  document.getElementById("uploadIcon").textContent = "⏳";
  document.getElementById("uploadTitle").textContent = "Excel Yukleniyor";
  document.getElementById("uploadProgressBar").style.width = "0%";
  document.getElementById("uploadProgressText").textContent = "Basliyor...";
  document.getElementById("uploadSummary").innerHTML = "";
  document.getElementById("uploadCloseBtn").classList.add("hidden");
  document.getElementById("uploadOverlay").classList.add("show");
  document.getElementById("uploadLabel").classList.add("disabled");
}
function updateUploadProgress(count, total){
  var pct = total ? Math.round((count / total) * 100) : 0;
  document.getElementById("uploadProgressBar").style.width = pct + "%";
  document.getElementById("uploadProgressText").textContent = count + " / " + total + " cari islendi (" + pct + "%)";
}
function finishUploadModal(success, summaryHtml){
  document.getElementById("uploadIcon").textContent = success ? "✅" : "⚠️";
  document.getElementById("uploadTitle").textContent = success ? "Yukleme Tamamlandi" : "Yukleme Basarisiz";
  document.getElementById("uploadProgressText").textContent = "";
  if (success) document.getElementById("uploadProgressBar").style.width = "100%";
  document.getElementById("uploadSummary").innerHTML = summaryHtml;
  document.getElementById("uploadCloseBtn").classList.remove("hidden");
  document.getElementById("uploadLabel").classList.remove("disabled");
}

async function handleExcelUpload(file){
  showUploadModal();
  try {
    var buf = await file.arrayBuffer();
    var data = new Uint8Array(buf);
    var wb = XLSX.read(data, { type: "array" });
    var sheet = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

    if (rows.length < 2){
      finishUploadModal(false, '<div class="line">Excel\'de veri bulunamadi.</div>');
      return;
    }
    // Baslik satiri her zaman ilk satirda olmayabilir (rapor basligi, filtre bilgisi gibi
    // ekstra satirlar olabilir). Ilk 10 satir icinde gerekli kolonlarin hepsinin bulundugu
    // satiri ariyoruz.
    var headerRowIndex = -1;
    var colIndex = {};
    var missing = [];
    var searchLimit = Math.min(10, rows.length);
    for (var hr = 0; hr < searchLimit; hr++){
      var testHeaders = rows[hr];
      var testColIndex = {};
      var testMissing = [];
      REQUIRED_COLUMNS.forEach(function(rc){
        var idx = findCol(testHeaders, rc.match);
        testColIndex[rc.label] = idx;
        if (idx === -1) testMissing.push(rc.label);
      });
      if (testMissing.length === 0){
        headerRowIndex = hr;
        colIndex = testColIndex;
        missing = [];
        break;
      }
      // en az eksigi olan satiri hata mesajinda gostermek icin sakla
      if (headerRowIndex === -1 || testMissing.length < missing.length || missing.length === 0){
        missing = testMissing;
      }
    }

    if (headerRowIndex === -1){
      finishUploadModal(false,
        '<div class="line">Excel\'in ilk ' + searchLimit + ' satirinda gerekli kolonlarin hepsini icinde barindiran bir baslik satiri bulunamadi.</div>' +
        '<div class="line">En yakin satirda eksik olan(lar): <b>' + escapeHtml(missing.join(", ")) + '</b></div>' +
        '<div class="line" style="margin-top:8px;">' + escapeHtml(requiredColumnsText()) + '</div>'
      );
      return;
    }

    var headers = rows[headerRowIndex];

    var unvanCol = colIndex["Ünvan"];
    var kategori1Col = colIndex["Cari Kategori 1"];
    var plakaCol = colIndex["Cari Kategori 5"];
    var debtCol = colIndex["Borç Bak."];
    var sonTahCol = colIndex["Son Tah. Tarihi"];
    var kodCol = findCol(headers, ["kod"]); // zorunlu degil, varsa daha saglam id icin kullanilir

    // bu yuklemeden hemen onceki durumun anlik goruntusu (once/sonra kiyaslari icin)
    var cariSnapshotAtStart = cariler.slice();
    var beforeTotals = {};
    cariSnapshotAtStart.forEach(function(c){
      if (!c.plaka) return;
      var np = normalizePlate(c.plaka);
      beforeTotals[np] = (beforeTotals[np] || 0) + (c.debt || 0);
    });

    document.getElementById("uploadProgressText").textContent = "Basliyor...";
    var count = 0, total = rows.length - (headerRowIndex + 1);
    var yeniPlakalar = {};
    var afterTotals = {};
    var newIds = {};
    var notesClearedCount = 0;

    var oldById = {};
    cariSnapshotAtStart.forEach(function(c){ oldById[c.id] = c; });

    for (var i = headerRowIndex + 1; i < rows.length; i++){
      var r = rows[i];
      var nm = (r[unvanCol] || "").toString().trim();
      if (!nm) continue;

      var kod = kodCol !== -1 ? (r[kodCol] || "").toString().trim() : "";
      var kategori1 = (r[kategori1Col] || "").toString().trim();
      var plaka = (r[plakaCol] || "").toString().trim();
      var debt = parseNumber(r[debtCol]);
      var sonTahTarihi = (r[sonTahCol] || "").toString().trim();
      var id = kod ? docIdFor(kod) : docIdFor(nm);
      newIds[id] = true;

      var updateData = {
        name: nm, kod: kod, kategori1: kategori1, plaka: plaka, debt: debt,
        sonTahTarihi: sonTahTarihi,
        aktif: true, updatedAt: serverTimestamp()
      };

      // Yeni tahsilat tarihi eskisinden ilerideyse (yeni bir odeme gelmis demektir),
      // Gecici (Not) otomatik temizlenir -- Sabit (Not) hicbir zaman dokunulmaz.
      var oldC = oldById[id];
      if (oldC){
        var oldDate = parseTRDate(oldC.sonTahTarihi);
        var newDate = parseTRDate(sonTahTarihi);
        if (newDate && (!oldDate || newDate > oldDate) && oldC.note){
          updateData.note = "";
          updateData.lastAction = "Yeni tahsilat tespit edildi, gecici not otomatik temizlendi";
          updateData.lastChangeDetail = 'Gecici not otomatik temizlendi (onceki: "' + oldC.note + '"). Sebep: Son Tahsilat Tarihi ' + (oldC.sonTahTarihi || "-") + ' -> ' + sonTahTarihi + ' olarak ilerledi.';
          updateData.lastEditedBy = "Sistem (Excel yuklemesi)";
          updateData.lastEditedAt = serverTimestamp();
          notesClearedCount++;
        }
      }

      await setDoc(doc(db, CARI_COLLECTION, id), updateData, { merge: true });

      if (plaka){
        var npNew = normalizePlate(plaka);
        yeniPlakalar[npNew] = plaka.toUpperCase().replace(/\s+/g, "");
        afterTotals[npNew] = (afterTotals[npNew] || 0) + debt;
      }
      count++;
      updateUploadProgress(count, total);
    }

    // Excel'de artik gecmeyen (once aktif olan) carileri pasife al -- veri kaybetmeden
    var toDeactivate = cariSnapshotAtStart.filter(function(c){ return c.aktif !== false && !newIds[c.id]; });
    for (var j = 0; j < toDeactivate.length; j++){
      await setDoc(doc(db, CARI_COLLECTION, toDeactivate[j].id), { aktif: false, updatedAt: serverTimestamp() }, { merge: true });
    }

    var mevcutNorm = plakaListesi.map(function(p){ return normalizePlate(p); });
    var eklenecekler = Object.keys(yeniPlakalar).filter(function(n){ return mevcutNorm.indexOf(n) === -1; }).map(function(n){ return yeniPlakalar[n]; });
    if (eklenecekler.length > 0 && plakaDocRef){
      try { await setDoc(plakaDocRef, { list: arrayUnion.apply(null, eklenecekler) }, { merge: true }); }
      catch (e) { console.error("[cariTakip] plaka listesi guncellenemedi:", e); }
    }

    var topPlaka = null, topCollected = -Infinity;
    Object.keys(afterTotals).forEach(function(np){
      var before = beforeTotals[np] || 0;
      var after = afterTotals[np];
      var collected = before - after;
      if (collected > topCollected){ topCollected = collected; topPlaka = yeniPlakalar[np]; }
    });

    // gunun toplam bakiyelerini (plaka bazli) bugunun gunluk kaydina yaz -- "Dunun Basarisi"
    // gercek takvim gunune gore hesaplanabilsin diye. Ayni gun birden fazla yukleme yapilirsa
    // bu kayit sadece guncellenir, ayri gun olusturmaz.
    if (Object.keys(afterTotals).length > 0){
      try {
        var todayStr = dateStr(new Date());
        var gunlukData = {};
        Object.keys(afterTotals).forEach(function(np){ gunlukData[yeniPlakalar[np]] = afterTotals[np]; });
        await setDoc(doc(db, GUNLUK_BAKIYE_COLLECTION, todayStr), gunlukData, { merge: true });
      } catch (e) { console.error("[cariTakip] gunluk bakiye yazilamadi:", e); }
    }

    if (metaDocRef){
      try { await setDoc(metaDocRef, { lastUploadAt: serverTimestamp() }, { merge: true }); }
      catch (e) { console.error("[cariTakip] meta guncellenemedi:", e); }
    }

    var summary = "";
    summary += '<div class="line"><span>Islenen cari</span><b>' + count + '</b></div>';
    summary += '<div class="line"><span>Pasife alinan (Excelde artik yok)</span><b>' + toDeactivate.length + '</b></div>';
    if (notesClearedCount > 0) summary += '<div class="line"><span>Yeni tahsilat nedeniyle temizlenen gecici not</span><b>' + notesClearedCount + '</b></div>';
    if (eklenecekler.length > 0) summary += '<div class="line"><span>Yeni eklenen plaka</span><b>' + eklenecekler.length + '</b></div>';
    if (topPlaka && topCollected > 0) summary += '<div class="line"><span>Bu yuklemede en cok azalan bakiye</span><b>' + escapeHtml(topPlaka) + ': ' + fmtMoney(topCollected) + '</b></div>';
    finishUploadModal(true, summary);
  } catch (err) {
    finishUploadModal(false, '<div class="line">Hata: ' + escapeHtml(err.message) + '</div>');
  }
}

// ---------- Firestore canli baglanti (cariler) ----------

function initRealtime(){
  setConnStatus("Baglaniyor...", false);
  if (unsubCariler) unsubCariler();
  try {
    unsubCariler = onSnapshot(collection(db, CARI_COLLECTION), function(snapshot){
      cariler = [];
      snapshot.forEach(function(docSnap){
        var d = docSnap.data();
        cariler.push({
          id: docSnap.id, name: d.name || docSnap.id,
          kategori1: d.kategori1 || "", plaka: d.plaka || "",
          debt: d.debt || 0, note: d.note || "", due: d.due || "", flagged: !!d.flagged,
          sonTahTarihi: d.sonTahTarihi || "",
          aktif: d.aktif !== false,
          paymentReported: !!d.paymentReported, paymentAmount: d.paymentAmount || 0,
          paymentReviewed: !!d.paymentReviewed, paymentReportedBy: d.paymentReportedBy || "",
          rejectionReason: d.rejectionReason || "",
          lastAction: d.lastAction || "",
          lastChangeDetail: d.lastChangeDetail || "",
          sabitNot: d.sabitNot || "",
          dueReadFor: d.dueReadFor || "",
          lastEditedBy: d.lastEditedBy || "", lastEditedAtLabel: fmtTimestamp(d.lastEditedAt)
        });
      });
      setConnStatus("Canli baglanti aktif", true);
      populateAdminFilters();
      render();
      if (document.getElementById("paymentOverlay").classList.contains("show")) renderPaymentList();
    }, function(error){
      console.error("Firestore onSnapshot hatasi:", error);
      setConnStatus("Baglanti hatasi: " + error.message, false);
    });
  } catch (e) {
    console.error("Firestore baglanti kurulamadi:", e);
    setConnStatus("Baglanti kurulamadi: " + e.message, false);
  }
}

// ---------- Hamburger / ikonlar ----------

function wireHamburger(){
  var btn = document.getElementById("hamburgerBtn");
  var menu = document.getElementById("hamburgerMenu");
  if (!btn || !menu) { console.error("[cariTakip] hamburger elemanlari eksik."); return; }

  btn.addEventListener("click", function(e){ e.stopPropagation(); menu.classList.toggle("hidden"); });
  document.addEventListener("click", function(e){ if (!menu.contains(e.target) && e.target !== btn) menu.classList.add("hidden"); });

  on("menuLogout", "click", function(e){ e.preventDefault(); logout(); });

  on("menuTahsilatDurumu", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    openTahsilatPanel();
  });

  on("menuOdemeBekleyen", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    openOdemeBekleyenPanel();
  });

  on("menuTrend", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ await customAlert("Tahsilat trendi sadece yoneticiler icindir.", "Yetki Yok"); return; }
    openTrendPanel();
  });

  on("menuPlakaDegistir", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    switchPlaka();
  });

  on("menuSifremDegistir", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin") return;
    var yeni = await customPrompt("Yeni sifrenizi girin (1-16 karakter):", "Sifremi Degistir");
    if (yeni === null) return;
    if (!yeni || yeni.length > 16){ await customAlert("Sifre 1-16 karakter arasinda olmalidir.", "Uyari"); return; }
    if (!currentAdminDocId){ await customAlert("Kullanici kaydiniz bulunamadi.", "Hata"); return; }
    try {
      await setDoc(doc(db, YONETICILER_COLLECTION, currentAdminDocId), { password: yeni }, { merge: true });
      await customAlert("Sifreniz guncellendi.", "Basarili");
    } catch (err) {
      await customAlert("Guncellenemedi: " + err.message, "Hata");
    }
  });

  on("menuPlasiyerSifresi", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ await customAlert("Bu islem sadece yoneticiler icindir.", "Yetki Yok"); return; }
    var yeni = await customPrompt("Plasiyer giris sifresini girin (1-16 karakter):", "Plasiyer Sifresini Degistir", currentSalesPin);
    if (yeni === null) return;
    if (!yeni || yeni.length > 16){ await customAlert("Sifre 1-16 karakter arasinda olmalidir.", "Uyari"); return; }
    try {
      await setDoc(sifrelerDocRef, { salesPin: yeni }, { merge: true });
      await customAlert("Plasiyer sifresi guncellendi: " + yeni, "Basarili");
    } catch (err) {
      await customAlert("Guncellenemedi: " + err.message, "Hata");
    }
  });

  on("menuKullaniciTanimlama", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ await customAlert("Bu islem sadece yoneticiler icindir.", "Yetki Yok"); return; }
    var superUser = adminUsers.find(function(u){ return u.id === SUPER_ADMIN_ID; });
    var superPass = superUser ? superUser.password : "admin123";
    var entered = await customPrompt("Kullanici tanimlama yetkisi icin sifreyi girin:", "Yetki Dogrulama");
    if (entered === null) return;
    if (entered !== superPass){ await customAlert("Yanlis sifre.", "Yetki Reddedildi"); return; }
    renderUserManagementList();
    document.getElementById("userMgmtStatus").textContent = "";
    document.getElementById("userMgmtOverlay").classList.add("show");
  });

  on("menuAltLimit", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ await customAlert("Alt limit sadece yoneticiler tarafindan degistirilebilir.", "Yetki Yok"); return; }
    var val = await customPrompt(
      "Bu tutarin altindaki bakiyeler tum listelerden (plasiyer ve yonetici) gizlenir.\nMevcut deger: " + fmtMoney(minBakiye),
      "Alt Limit Belirle", String(minBakiye)
    );
    if (val === null) return;
    var num = parseFloat(val.toString().replace(",", "."));
    if (isNaN(num) || num < 0){ await customAlert("Gecerli bir sayi girin.", "Uyari"); return; }
    try {
      await setDoc(ayarlarDocRef, { minBakiye: num }, { merge: true });
      await customAlert("Alt limit guncellendi: " + fmtMoney(num), "Basarili");
    } catch (err) {
      await customAlert("Guncellenemedi: " + err.message, "Hata");
    }
  });

  on("menuSoforTanimlama", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ await customAlert("Sofor tanimlama sadece yoneticiler icindir.", "Yetki Yok"); return; }
    renderSoforList();
    document.getElementById("soforStatus").textContent = "";
    document.getElementById("soforOverlay").classList.add("show");
  });

  on("menuBasari", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    openBasariPanel();
  });

  on("menuPlakaYonetimi", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ await customAlert("Plaka yonetimi sadece yoneticiler icindir.", "Yetki Yok"); return; }
    renderPlakaManagementList();
    document.getElementById("plakaStatus").textContent = "";
    document.getElementById("plakaOverlay").classList.add("show");
  });

  on("menuGecmis", "click", async function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ await customAlert("Gecmis kayitlari sadece yoneticiler icindir.", "Yetki Yok"); return; }
    document.getElementById("historySearch").value = "";
    renderHistoryList();
    document.getElementById("historyOverlay").classList.add("show");
  });

  on("closePlakaBtn", "click", function(){ document.getElementById("plakaOverlay").classList.remove("show"); });
  on("plakaOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });
  on("addPlakaBtn", "click", addPlaka);
  on("newPlakaInput", "keydown", function(e){ if (e.key === "Enter") addPlaka(); });

  on("closeSoforBtn", "click", function(){ document.getElementById("soforOverlay").classList.remove("show"); });
  on("soforOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });

  on("closeBasariBtn", "click", function(){ document.getElementById("basariOverlay").classList.remove("show"); });
  on("basariOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });

  on("closeHistoryBtn", "click", function(){ document.getElementById("historyOverlay").classList.remove("show"); });
  on("historyOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });
  on("historySearch", "input", renderHistoryList);

  on("paymentIconBtn", "click", function(){
    renderPaymentList();
    document.getElementById("paymentStatus").textContent = "";
    document.getElementById("paymentOverlay").classList.add("show");
  });
  on("closePaymentBtn", "click", function(){ document.getElementById("paymentOverlay").classList.remove("show"); });
  on("paymentOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });

  on("dueAlertBtn", "click", function(){
    renderDueAlertList();
    document.getElementById("dueAlertOverlay").classList.add("show");
  });
  on("closeDueAlertBtn", "click", function(){ document.getElementById("dueAlertOverlay").classList.remove("show"); });
  on("dueAlertOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });

  on("closeUserMgmtBtn", "click", function(){ document.getElementById("userMgmtOverlay").classList.remove("show"); });
  on("userMgmtOverlay", "click", function(e){ if (e.target === this) this.classList.remove("show"); });
  on("addUserBtn", "click", async function(){
    var name = document.getElementById("newUserNameInput").value.trim();
    var pass = document.getElementById("newUserPassInput").value;
    var status = document.getElementById("userMgmtStatus");
    if (!name){ status.textContent = "Isim girin."; return; }
    if (!pass || pass.length > 16){ status.textContent = "Sifre 1-16 karakter olmali."; return; }
    var id = docIdFor(name);
    if (adminUsers.some(function(u){ return u.id === id; })){ status.textContent = "Bu isim zaten kayitli."; return; }
    status.textContent = "Ekleniyor...";
    try {
      await setDoc(doc(db, YONETICILER_COLLECTION, id), { name: name, password: pass, isSuper: false });
      document.getElementById("newUserNameInput").value = "";
      document.getElementById("newUserPassInput").value = "";
      status.textContent = "Eklendi.";
    } catch (err) {
      status.textContent = "Eklenemedi: " + err.message;
    }
  });

  applyMenuVisibility();
}

function applyMenuVisibility(){
  var mp = document.getElementById("menuPlakaYonetimi");
  var mg = document.getElementById("menuGecmis");
  var ms = document.getElementById("menuSoforTanimlama");
  var md = document.getElementById("menuPlakaDegistir");
  var mt = document.getElementById("menuTrend");
  var ma = document.getElementById("menuAltLimit");
  var msf = document.getElementById("menuSifremDegistir");
  var mps = document.getElementById("menuPlasiyerSifresi");
  var mkt = document.getElementById("menuKullaniciTanimlama");
  if (currentRole === "admin"){
    if (mp) mp.classList.remove("hidden");
    if (mg) mg.classList.remove("hidden");
    if (ms) ms.classList.remove("hidden");
    if (mt) mt.classList.remove("hidden");
    if (ma) ma.classList.remove("hidden");
    if (msf) msf.classList.remove("hidden");
    if (mps) mps.classList.remove("hidden");
    if (mkt) mkt.classList.remove("hidden");
    if (md) md.classList.add("hidden");
  } else {
    if (mp) mp.classList.add("hidden");
    if (mg) mg.classList.add("hidden");
    if (ms) ms.classList.add("hidden");
    if (mt) mt.classList.add("hidden");
    if (ma) ma.classList.add("hidden");
    if (msf) msf.classList.add("hidden");
    if (mps) mps.classList.add("hidden");
    if (mkt) mkt.classList.add("hidden");
    if (md) md.classList.remove("hidden");
  }
}

function switchPlaka(){
  document.getElementById("appRoot").classList.add("locked");
  document.getElementById("lockScreen").classList.remove("hidden");
  showSalesForm();
}

// ---------- Olay baglama ----------

function wirePaidSwitch(){
  on("paidSwitch", "click", function(){
    this.classList.toggle("on");
    this.classList.toggle("paidsw");
    document.getElementById("paidAmountRow").classList.toggle("show", this.classList.contains("on"));
  });
}

function wireAdminFilters(){
  on("filterKategori1", "change", render);
  on("filterPlaka", "change", render);
  on("clearKategori1Btn", "click", function(){ document.getElementById("filterKategori1").value = ""; render(); });
  on("clearPlakaBtn", "click", function(){ document.getElementById("filterPlaka").value = ""; render(); });
  on("clearAllFiltersBtn", "click", function(){
    document.getElementById("filterKategori1").value = "";
    document.getElementById("filterPlaka").value = "";
    render();
  });
}

function wireEvents(){
  on("flagSwitch", "click", function(){ this.classList.toggle("on"); });
  on("closeBtn", "click", closeDetail);
  on("overlay", "click", function(e){ if (e.target === this) closeDetail(); });
  on("saveBtn", "click", saveCurrentNote);
  on("clearDetailBtn", "click", clearCurrentDetail);
  on("detailEditor", "click", function(){ if (currentDocId) showChangeDetail(currentDocId); });
  on("searchBox", "input", function(){
    document.getElementById("searchClearBtn").classList.toggle("show", this.value.length > 0);
    render();
  });
  on("searchClearBtn", "click", function(){
    var box = document.getElementById("searchBox");
    box.value = "";
    this.classList.remove("show");
    box.focus();
    render();
  });
  on("chipFlag", "click", function(){ activeQuickFilter = activeQuickFilter === "flagged" ? null : "flagged"; render(); });
  on("chipNoted", "click", function(){ activeQuickFilter = activeQuickFilter === "noted" ? null : "noted"; render(); });
  on("chipDueToday", "click", function(){ activeQuickFilter = activeQuickFilter === "duetoday" ? null : "duetoday"; render(); });
  on("fileInput", "change", function(e){ var f = e.target.files[0]; if (f) handleExcelUpload(f); e.target.value = ""; });
  on("uploadCloseBtn", "click", function(){ document.getElementById("uploadOverlay").classList.remove("show"); });
  wireCalendar();
  wireHamburger();
  wirePaidSwitch();
  wireAdminFilters();
  wireCustomModal();
  wireTahsilatPanel();
  wireOdemeBekleyenPanel();
  wireTrendPanel();
}

function logout(){
  try {
    localStorage.removeItem(UNLOCK_KEY); localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USERNAME_KEY); localStorage.removeItem(PLAKA_KEY);
  } catch (e) {}
  location.reload();
}

function applyRoleUI(){
  var uploadRow = document.getElementById("uploadRow");
  var userInfo = document.getElementById("userInfo");
  var reqCols = document.getElementById("requiredCols");
  var filterRow = document.getElementById("adminFilterRow");
  var clearAllBtn = document.getElementById("clearAllFiltersBtn");
  var clearBtn = document.getElementById("clearDetailBtn");

  if (currentRole === "admin"){
    uploadRow.classList.remove("hidden");
    filterRow.classList.remove("hidden");
    clearBtn.classList.remove("hidden");
    reqCols.textContent = requiredColumnsText();
    userInfo.innerHTML = 'Yonetici: <b>' + escapeHtml(currentUserName) + '</b>';
  } else {
    uploadRow.classList.add("hidden");
    filterRow.classList.add("hidden");
    clearAllBtn.classList.remove("show");
    clearBtn.classList.add("hidden");
    reqCols.textContent = "";
    var plakaLabel = currentPlakalar[0] === PLAKA_YOK ? "Plaka Yok" : (currentPlakalar[0] || "");
    var isim = currentPlakalar[0] === PLAKA_YOK ? "" : soforAdi(plakaLabel);
    userInfo.innerHTML = 'Plasiyer: <b>' + escapeHtml(plakaLabel) + (isim ? " - " + escapeHtml(isim) : "") + '</b>';
  }
  applyMenuVisibility();
}

function unlockApp(){
  console.log("[cariTakip] Kilit aciliyor. Rol:", currentRole, "Kullanici:", currentUserName, "Plaka:", currentPlakalar);
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("locked");
  applyRoleUI();
  updateMinBakiyeLabel();
  updateVeriTarihiLabel();
  if (!appWired){ wireEvents(); appWired = true; }
  initRealtime();
  if (currentRole === "admin") watchHistory();
  checkNightLock();
  if (nightLockInterval) clearInterval(nightLockInterval);
  nightLockInterval = setInterval(checkNightLock, 60 * 1000);
}

// ---------- Giris ekrani ----------

function showRoleChoice(){
  document.getElementById("roleChoice").classList.remove("hidden");
  document.getElementById("salesForm").classList.add("hidden");
  document.getElementById("adminForm").classList.add("hidden");
  document.getElementById("pinError").textContent = "";
}
function showSalesForm(){
  document.getElementById("roleChoice").classList.add("hidden");
  document.getElementById("salesForm").classList.remove("hidden");
  document.getElementById("adminForm").classList.add("hidden");
  document.getElementById("pinError").textContent = "";
  document.getElementById("salesPinInput").classList.add("hidden");
  document.getElementById("salesSubmitBtn").classList.add("hidden");
  document.getElementById("salesPinInput").value = "";
  document.getElementById("salesPlakaSelect").value = "";
  populateSalesDropdown();
}
function showAdminForm(){
  document.getElementById("roleChoice").classList.add("hidden");
  document.getElementById("salesForm").classList.add("hidden");
  document.getElementById("adminForm").classList.remove("hidden");
  document.getElementById("pinError").textContent = "";
  populateAdminDropdown();
  var savedName = "";
  try { savedName = localStorage.getItem(USERNAME_KEY) || ""; } catch (e) {}
  if (savedName){
    var match = adminUsers.find(function(u){ return u.name === savedName; });
    if (match) document.getElementById("adminNameSelect").value = match.id;
  }
  document.getElementById("adminPinInput").value = "";
  document.getElementById("adminPinInput").focus();
}

function trySalesLogin(plaka){
  if (!plaka) return;
  currentRole = "sales";
  currentPlakalar = [plaka === PLAKA_YOK ? PLAKA_YOK : normalizePlate(plaka)];
  currentUserName = "";
  try {
    localStorage.setItem(UNLOCK_KEY, "1");
    localStorage.setItem(ROLE_KEY, "sales");
    localStorage.setItem(PLAKA_KEY, plaka);
  } catch (e) {}
  unlockApp();
}

function submitSalesLogin(){
  var err = document.getElementById("pinError");
  var plaka = document.getElementById("salesPlakaSelect").value;
  var pin = document.getElementById("salesPinInput").value;
  if (!plaka){ err.textContent = "Lutfen plaka secin."; return; }
  if (pin !== currentSalesPin){ err.textContent = "Yanlis PIN."; document.getElementById("salesPinInput").value = ""; return; }
  trySalesLogin(plaka);
}

function tryAdminLogin(){
  var err = document.getElementById("pinError");
  var uid = document.getElementById("adminNameSelect").value;
  var pin = document.getElementById("adminPinInput").value;
  if (!uid){ err.textContent = "Lutfen isim secin."; return; }
  var user = adminUsers.find(function(u){ return u.id === uid; });
  if (!user || pin !== user.password){ err.textContent = "Yanlis sifre."; document.getElementById("adminPinInput").value = ""; return; }
  currentUserName = user.name; currentAdminDocId = user.id; currentRole = "admin"; currentPlakalar = [];
  try {
    localStorage.setItem(UNLOCK_KEY, "1");
    localStorage.setItem(ROLE_KEY, "admin");
    localStorage.setItem(USERNAME_KEY, user.name);
    localStorage.setItem(ADMIN_DOC_ID_KEY, user.id);
  } catch (e) {}
  unlockApp();
}

function wireLoginScreen(){
  on("roleSalesBtn", "click", showSalesForm);
  on("roleAdminBtn", "click", showAdminForm);
  on("salesBack", "click", function(e){ e.preventDefault(); showRoleChoice(); });
  on("adminBack", "click", function(e){ e.preventDefault(); showRoleChoice(); });
  on("salesPlakaSelect", "change", function(){
    document.getElementById("pinError").textContent = "";
    if (this.value){
      document.getElementById("salesPinInput").classList.remove("hidden");
      document.getElementById("salesSubmitBtn").classList.remove("hidden");
      document.getElementById("salesPinInput").value = "";
      document.getElementById("salesPinInput").focus();
    } else {
      document.getElementById("salesPinInput").classList.add("hidden");
      document.getElementById("salesSubmitBtn").classList.add("hidden");
    }
  });
  on("salesSubmitBtn", "click", submitSalesLogin);
  on("salesPinInput", "keydown", function(e){ if (e.key === "Enter") submitSalesLogin(); });
  on("adminSubmit", "click", tryAdminLogin);
  on("adminPinInput", "keydown", function(e){ if (e.key === "Enter") tryAdminLogin(); });
}

// ---------- Baslangic ----------

watchPlakaConfig();
watchMeta();
watchSofor();
watchAyarlar();
watchSifreler();
watchYoneticiler();

var alreadyUnlocked = false, savedRole = "", savedUserName = "", savedPlaka = "";
try {
  alreadyUnlocked = localStorage.getItem(UNLOCK_KEY) === "1";
  savedRole = localStorage.getItem(ROLE_KEY) || "";
  savedUserName = localStorage.getItem(USERNAME_KEY) || "";
  savedPlaka = localStorage.getItem(PLAKA_KEY) || "";
} catch (e) {}

console.log("[cariTakip] app.js yuklendi. alreadyUnlocked =", alreadyUnlocked, "rol =", savedRole);

wireLoginScreen();
wireNightBypass();

if (alreadyUnlocked && savedRole === "admin" && savedUserName){
  currentUserName = savedUserName; currentRole = "admin";
  try { currentAdminDocId = localStorage.getItem(ADMIN_DOC_ID_KEY) || docIdFor(savedUserName); } catch (e) { currentAdminDocId = docIdFor(savedUserName); }
  unlockApp();
} else if (alreadyUnlocked && savedRole === "sales" && savedPlaka){
  currentRole = "sales";
  currentPlakalar = [savedPlaka === PLAKA_YOK ? PLAKA_YOK : normalizePlate(savedPlaka)];
  unlockApp();
}
