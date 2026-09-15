// app.js — Cari Takip: rol bazli giris, odeme onay/red akisi, gunluk basari,
// sofor tanimlama, yonetici filtreleri, gece kilidi, gecmis kaydi.

import { db } from "./firebase-core.js";
import {
  collection, doc, setDoc, onSnapshot,
  serverTimestamp, arrayUnion, arrayRemove,
  query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---- Yonetici PIN'i ----
const ADMIN_PIN = "1234";

const UNLOCK_KEY = "cariTakip_unlocked_v5";
const ROLE_KEY = "cariTakip_role_v5";
const USERNAME_KEY = "cariTakip_userName_v5";
const PLAKA_KEY = "cariTakip_plaka_v5";

const CARI_COLLECTION = "cariler";
const HISTORY_COLLECTION = "gecmis";
const PLAKA_DOC = { col: "config", id: "plakalar" };
const META_DOC = { col: "config", id: "meta" };
const SOFOR_DOC = { col: "config", id: "soforler" };
const BASARI_DOC = { col: "config", id: "gunluk_basari" };
const PLAKA_YOK = "PLAKA_YOK";

// Excelde bulunmasi zorunlu (sadece bunlar) kolonlar
const REQUIRED_COLUMNS = [
  { label: "Ünvan", match: ["ünvan", "unvan"] },
  { label: "Cari Kategori 1", match: ["cari kategori 1"] },
  { label: "Cari Kategori 5", match: ["cari kategori 5"] },
  { label: "Borç Bak.", match: ["borç bak", "borc bak"] }
];

var plakaDocRef = null;
var metaDocRef = null;
var soforDocRef = null;
var basariDocRef = null;

var cariler = [];
var plakaListesi = [];
var soforMap = {}; // plaka -> isim
var lastUploadAt = null;
var basariData = null;

var currentDocId = null;
var currentUserName = "";
var currentRole = "";
var currentPlakalar = [];
var nightLockActive = false;
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
      checkNightLock();
    }, function(err){ console.error("[cariTakip] meta dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] meta baglanamadi:", e); }
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

function watchBasari(){
  try {
    basariDocRef = doc(db, BASARI_DOC.col, BASARI_DOC.id);
    onSnapshot(basariDocRef, function(snap){
      basariData = snap.exists() ? snap.data() : null;
      if (document.getElementById("basariOverlay").classList.contains("show")) renderBasari();
    }, function(err){ console.error("[cariTakip] basari dinlenemedi:", err); });
  } catch (e) { console.error("[cariTakip] basari baglanamadi:", e); }
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
  if (!confirm('"' + plaka + '" plakasini kaldirmak istediginize emin misiniz?')) return;
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

function renderBasari(){
  var body = document.getElementById("basariBody");
  if (!basariData || !basariData.topPlaka){
    body.innerHTML = '<div class="empty">Henuz karsilastirma verisi yok. Yeni bir Excel yuklendiginde otomatik hesaplanacak.</div>';
    return;
  }
  var isim = soforAdi(basariData.topPlaka);
  var html = '<div class="basari-box">';
  html += '  <div class="trophy">🏆</div>';
  html += '  <div class="plate">' + escapeHtml(basariData.topPlaka) + '</div>';
  if (isim) html += '  <div class="sofor">' + escapeHtml(isim) + '</div>';
  html += '  <div class="amount">' + fmtMoney(basariData.topCollected) + '</div>';
  html += '  <div class="caption">Son Excel yuklemesinde en cok tahsilat yapan plaka</div>';
  html += '</div>';
  body.innerHTML = html;
}

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
  var now = new Date();
  var cutoff = computeLastCutoff(now);
  var locked = !lastUploadAt || lastUploadAt < cutoff;
  nightLockActive = locked;
  if (locked) showNightLock(); else hideNightLock();
}
function showNightLock(){ var el = document.getElementById("nightLock"); if (el) el.classList.add("show"); }
function hideNightLock(){ var el = document.getElementById("nightLock"); if (el) el.classList.remove("show"); }

// ---------- Rol bazli gorunur liste ----------

function getVisibleCariler(){
  var base = cariler;
  if (currentRole === "sales"){
    var wantYok = currentPlakalar.indexOf(PLAKA_YOK) !== -1;
    base = cariler.filter(function(c){
      if (wantYok) return !c.plaka;
      if (!c.plaka) return false;
      return currentPlakalar.indexOf(normalizePlate(c.plaka)) !== -1;
    });
  } else if (currentRole === "admin"){
    var k1 = document.getElementById("filterKategori1") ? document.getElementById("filterKategori1").value : "";
    var pk = document.getElementById("filterPlaka") ? document.getElementById("filterPlaka").value : "";
    base = cariler.filter(function(c){
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

function render(){
  var list = document.getElementById("list");
  var q = document.getElementById("searchBox").value.toLocaleLowerCase("tr").trim();
  var visible = getVisibleCariler();
  var filtered = visible.filter(function(c){ return !q || c.name.toLocaleLowerCase("tr").indexOf(q) !== -1; });

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
      var cls = c.flagged ? " flagged" : (c.paymentReported ? " paid" : "");
      var debtClass = (c.debt || 0) === 0 ? " zero" : "";
      html += '<div class="row' + cls + '" data-id="' + escapeAttr(c.id) + '">';
      html += '  <div class="left">';
      html += '    <div class="name">' + escapeHtml(c.name) + '</div>';
      html += '    <div class="tags">';
      if (c.kategori1) html += '<span class="tag">' + escapeHtml(c.kategori1) + '</span>';
      html += '<span class="tag">' + escapeHtml(c.plaka || "Plaka yok") + '</span>';
      html += '    </div>';
      if (c.note) html += '    <div class="note-preview">' + escapeHtml(c.note) + '</div>';
      if (c.due) html += '    <div class="due">Odeme bekleniyor: ' + escapeHtml(fmtDateISOtoTR(c.due)) + '</div>';
      if (c.paymentReported){
        html += '    <div class="paidline">✅ Odeme bildirildi: ' + fmtMoney(c.paymentAmount) + (c.paymentReviewed ? " (onaylandi)" : " (bekliyor)") + '</div>';
      }
      if (c.rejectionReason){
        html += '    <div class="rejectline">⚠️ Reddedildi: ' + escapeHtml(c.rejectionReason) + '</div>';
      }
      if (c.lastEditedBy){
        html += '    <div class="editor">Son duzenleyen: ' + escapeHtml(c.lastEditedBy) + (c.lastEditedAtLabel ? " - " + escapeHtml(c.lastEditedAtLabel) : "") + '</div>';
      }
      html += '  </div>';
      html += '  <div class="right">';
      html += '    <div class="debt' + debtClass + '">' + fmtMoney(c.debt) + '</div>';
      if (c.flagged) html += '    <div class="badgetxt">SORUNLU</div>';
      html += '  </div>';
      html += '</div>';
    }
    list.innerHTML = html;
    list.querySelectorAll(".row").forEach(function(row){
      row.addEventListener("click", function(){ openDetail(row.getAttribute("data-id")); });
    });
  }

  document.getElementById("sumCount").textContent = visible.length;
  document.getElementById("sumDebt").textContent = fmtMoney(visible.reduce(function(s, c){ return s + (c.debt || 0); }, 0));
  document.getElementById("sumFlag").textContent = visible.filter(function(c){ return c.flagged; }).length;

  var pendingCount = pendingPaymentsIn(visible).length;
  var badge = document.getElementById("paymentBadge");
  if (pendingCount > 0){ badge.textContent = pendingCount; badge.classList.remove("hidden"); }
  else { badge.classList.add("hidden"); }
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
  if (c.rejectionReason) editorText += " | ⚠️ Reddedildi: " + c.rejectionReason;
  document.getElementById("detailEditor").textContent = editorText;

  var metaParts = [];
  if (c.kategori1) metaParts.push("Bolge: " + c.kategori1);
  metaParts.push("Plaka: " + (c.plaka || "Yok"));
  document.getElementById("detailMeta").textContent = metaParts.join(" | ");

  document.getElementById("debtInput").value = c.debt || 0;
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
  document.getElementById("paidAmountInput").value = c.paymentAmount || "";
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

async function writeHistory(c, data){
  try {
    var histRef = doc(collection(db, HISTORY_COLLECTION));
    await setDoc(histRef, {
      cariId: c.id, cariName: c.name, plaka: c.plaka || "",
      note: data.note, due: data.due, flagged: data.flagged, debt: data.debt,
      paymentReported: data.paymentReported, paymentAmount: data.paymentAmount || 0,
      editedBy: data.lastEditedBy, editedAt: serverTimestamp()
    });
  } catch (e) { console.error("[cariTakip] gecmis kaydi yazilamadi:", e); }
}

async function saveCurrentNote(){
  if (!currentDocId) return;
  var status = document.getElementById("saveStatus");
  var c = cariler.find(function(x){ return x.id === currentDocId; });
  var debtVal = parseFloat(document.getElementById("debtInput").value);
  if (isNaN(debtVal)) debtVal = 0;

  var paid = document.getElementById("paidSwitch").classList.contains("on");
  var paidAmount = parseFloat(document.getElementById("paidAmountInput").value);
  if (isNaN(paidAmount)) paidAmount = 0;

  var data = {
    debt: debtVal,
    note: document.getElementById("noteInput").value,
    due: document.getElementById("dueInput").value,
    flagged: document.getElementById("flagSwitch").classList.contains("on"),
    paymentReported: paid,
    paymentAmount: paid ? paidAmount : 0,
    lastEditedBy: editorLabel(),
    updatedAt: serverTimestamp(),
    lastEditedAt: serverTimestamp()
  };
  if (paid && !(c && c.paymentReported)){
    data.paymentReportedBy = editorLabel();
    data.paymentReportedAt = serverTimestamp();
    data.paymentReviewed = false;
    data.rejectionReason = ""; // yeni bildirim eski red notunu temizler
  } else if (!paid){
    data.paymentReviewed = false;
    data.paymentReportedBy = "";
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
    html += '  <div class="ractions">';
    if (currentRole === "admin"){
      html += '<button type="button" class="approve" data-act="approve">Onayla</button>';
      html += '<button type="button" class="reject" data-act="reject">Reddet</button>';
      html += '<button type="button" class="clearnote" data-act="clearnote">Notu Temizle</button>';
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
  try {
    if (action === "approve"){
      status.textContent = "Isleniyor...";
      await setDoc(doc(db, CARI_COLLECTION, id), {
        paymentReviewed: true, rejectionReason: "",
        lastEditedBy: editorLabel(), lastEditedAt: serverTimestamp()
      }, { merge: true });
      status.textContent = "Onaylandi.";
    } else if (action === "reject"){
      var reason = prompt("Reddetme sebebini yazin (orn: Odeme yetersiz, yarin POS cektir):", "");
      if (reason === null) return;
      if (!reason.trim()){ status.textContent = "Sebep girmeden reddedemezsiniz."; return; }
      status.textContent = "Isleniyor...";
      await setDoc(doc(db, CARI_COLLECTION, id), {
        paymentReported: false, paymentAmount: 0, paymentReviewed: false, paymentReportedBy: "",
        rejectionReason: reason.trim(), rejectedBy: editorLabel(), rejectedAt: serverTimestamp(),
        lastEditedBy: editorLabel(), lastEditedAt: serverTimestamp()
      }, { merge: true });
      status.textContent = "Reddedildi.";
    } else if (action === "clearnote"){
      status.textContent = "Isleniyor...";
      await setDoc(doc(db, CARI_COLLECTION, id), {
        note: "", due: "", flagged: false,
        paymentReported: false, paymentAmount: 0, paymentReviewed: false, paymentReportedBy: "", rejectionReason: "",
        lastEditedBy: editorLabel(), lastEditedAt: serverTimestamp()
      }, { merge: true });
      status.textContent = "Not temizlendi.";
    } else if (action === "cancel"){
      status.textContent = "Isleniyor...";
      await setDoc(doc(db, CARI_COLLECTION, id), {
        paymentReported: false, paymentAmount: 0, paymentReviewed: false, paymentReportedBy: "",
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

// ---------- Excel yukleme (sadece yonetici) ----------

function requiredColumnsText(){
  return "Gerekli kolonlar: " + REQUIRED_COLUMNS.map(function(c){ return c.label; }).join(", ");
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

    var colIndex = {};
    var missing = [];
    REQUIRED_COLUMNS.forEach(function(rc){
      var idx = findCol(headers, rc.match);
      colIndex[rc.label] = idx;
      if (idx === -1) missing.push(rc.label);
    });
    if (missing.length > 0){
      alert('Excel dosyasinda su kolon(lar) eksik: ' + missing.join(", ") + '.\n\n' + requiredColumnsText());
      label.textContent = "Excel Yukle (.xlsx)";
      return;
    }

    var unvanCol = colIndex["Ünvan"];
    var kategori1Col = colIndex["Cari Kategori 1"];
    var plakaCol = colIndex["Cari Kategori 5"];
    var debtCol = colIndex["Borç Bak."];
    var kodCol = findCol(headers, ["kod"]); // zorunlu degil, varsa daha saglam id icin kullanilir

    // "onceki" plaka bazli toplam bakiyeler (bu yuklemeden hemen once, mevcut canli veriden)
    var beforeTotals = {};
    cariler.forEach(function(c){
      if (!c.plaka) return;
      var np = normalizePlate(c.plaka);
      beforeTotals[np] = (beforeTotals[np] || 0) + (c.debt || 0);
    });

    label.textContent = "Yukleniyor 0/" + (rows.length - 1);
    var count = 0, total = rows.length - 1;
    var yeniPlakalar = {};
    var afterTotals = {};

    for (var i = 1; i < rows.length; i++){
      var r = rows[i];
      var nm = (r[unvanCol] || "").toString().trim();
      if (!nm) continue;

      var kod = kodCol !== -1 ? (r[kodCol] || "").toString().trim() : "";
      var kategori1 = (r[kategori1Col] || "").toString().trim();
      var plaka = (r[plakaCol] || "").toString().trim();
      var debt = parseNumber(r[debtCol]);
      var id = kod ? docIdFor(kod) : docIdFor(nm);

      await setDoc(doc(db, CARI_COLLECTION, id), {
        name: nm, kod: kod, kategori1: kategori1, plaka: plaka, debt: debt, updatedAt: serverTimestamp()
      }, { merge: true });

      if (plaka){
        var npNew = normalizePlate(plaka);
        yeniPlakalar[npNew] = plaka.toUpperCase().replace(/\s+/g, "");
        afterTotals[npNew] = (afterTotals[npNew] || 0) + debt;
      }
      count++;
      label.textContent = "Yukleniyor " + count + "/" + total;
    }

    var mevcutNorm = plakaListesi.map(function(p){ return normalizePlate(p); });
    var eklenecekler = Object.keys(yeniPlakalar).filter(function(n){ return mevcutNorm.indexOf(n) === -1; }).map(function(n){ return yeniPlakalar[n]; });
    if (eklenecekler.length > 0 && plakaDocRef){
      try { await setDoc(plakaDocRef, { list: arrayUnion.apply(null, eklenecekler) }, { merge: true }); }
      catch (e) { console.error("[cariTakip] plaka listesi guncellenemedi:", e); }
    }

    // gunun basarisi: bu excelde gecen plakalar icin (once - sonra) farki
    var topPlaka = null, topCollected = -Infinity;
    Object.keys(afterTotals).forEach(function(np){
      var before = beforeTotals[np] || 0;
      var after = afterTotals[np];
      var collected = before - after;
      if (collected > topCollected){ topCollected = collected; topPlaka = yeniPlakalar[np]; }
    });
    if (topPlaka && topCollected > 0 && basariDocRef){
      try {
        await setDoc(basariDocRef, {
          topPlaka: topPlaka, topCollected: topCollected, hesaplananTarih: serverTimestamp()
        }, { merge: false });
      } catch (e) { console.error("[cariTakip] basari kaydi yazilamadi:", e); }
    }

    if (metaDocRef){
      try { await setDoc(metaDocRef, { lastUploadAt: serverTimestamp() }, { merge: true }); }
      catch (e) { console.error("[cariTakip] meta guncellenemedi:", e); }
    }

    label.textContent = "Excel Yukle (.xlsx)";
    alert("Yukleme tamamlandi: " + count + " cari islendi.");
  } catch (err) {
    alert("Dosya okunurken hata olustu: " + err.message);
    label.textContent = "Excel Yukle (.xlsx)";
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
          paymentReported: !!d.paymentReported, paymentAmount: d.paymentAmount || 0,
          paymentReviewed: !!d.paymentReviewed, paymentReportedBy: d.paymentReportedBy || "",
          rejectionReason: d.rejectionReason || "",
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

  on("menuPlakaDegistir", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    switchPlaka();
  });

  on("menuSoforTanimlama", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ alert("Sofor tanimlama sadece yoneticiler icindir."); return; }
    renderSoforList();
    document.getElementById("soforStatus").textContent = "";
    document.getElementById("soforOverlay").classList.add("show");
  });

  on("menuBasari", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    renderBasari();
    document.getElementById("basariOverlay").classList.add("show");
  });

  on("menuPlakaYonetimi", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ alert("Plaka yonetimi sadece yoneticiler icindir."); return; }
    renderPlakaManagementList();
    document.getElementById("plakaStatus").textContent = "";
    document.getElementById("plakaOverlay").classList.add("show");
  });

  on("menuGecmis", "click", function(e){
    e.preventDefault(); menu.classList.add("hidden");
    if (currentRole !== "admin"){ alert("Gecmis kayitlari sadece yoneticiler icindir."); return; }
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

  applyMenuVisibility();
}

function applyMenuVisibility(){
  var mp = document.getElementById("menuPlakaYonetimi");
  var mg = document.getElementById("menuGecmis");
  var ms = document.getElementById("menuSoforTanimlama");
  var md = document.getElementById("menuPlakaDegistir");
  if (currentRole === "admin"){
    if (mp) mp.classList.remove("hidden");
    if (mg) mg.classList.remove("hidden");
    if (ms) ms.classList.remove("hidden");
    if (md) md.classList.add("hidden");
  } else {
    if (mp) mp.classList.add("hidden");
    if (mg) mg.classList.add("hidden");
    if (ms) ms.classList.add("hidden");
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
}

function wireEvents(){
  on("flagSwitch", "click", function(){ this.classList.toggle("on"); });
  on("closeBtn", "click", closeDetail);
  on("overlay", "click", function(e){ if (e.target === this) closeDetail(); });
  on("saveBtn", "click", saveCurrentNote);
  on("searchBox", "input", render);
  on("fileInput", "change", function(e){ var f = e.target.files[0]; if (f) handleExcelUpload(f); e.target.value = ""; });
  wireCalendar();
  wireHamburger();
  wirePaidSwitch();
  wireAdminFilters();
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

  if (currentRole === "admin"){
    uploadRow.classList.remove("hidden");
    filterRow.classList.remove("hidden");
    reqCols.textContent = requiredColumnsText();
    userInfo.innerHTML = 'Yonetici: <b>' + escapeHtml(currentUserName) + '</b>';
  } else {
    uploadRow.classList.add("hidden");
    filterRow.classList.add("hidden");
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
  populateSalesDropdown();
}
function showAdminForm(){
  document.getElementById("roleChoice").classList.add("hidden");
  document.getElementById("salesForm").classList.add("hidden");
  document.getElementById("adminForm").classList.remove("hidden");
  document.getElementById("pinError").textContent = "";
  var savedName = "";
  try { savedName = localStorage.getItem(USERNAME_KEY) || ""; } catch (e) {}
  if (savedName) document.getElementById("adminNameInput").value = savedName;
  document.getElementById("adminNameInput").focus();
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

function tryAdminLogin(){
  var err = document.getElementById("pinError");
  var nm = document.getElementById("adminNameInput").value.trim();
  var pin = document.getElementById("adminPinInput").value;
  if (!nm){ err.textContent = "Lutfen isminizi girin."; return; }
  if (pin !== ADMIN_PIN){ err.textContent = "Yanlis PIN."; document.getElementById("adminPinInput").value = ""; return; }
  currentUserName = nm; currentRole = "admin"; currentPlakalar = [];
  try {
    localStorage.setItem(UNLOCK_KEY, "1");
    localStorage.setItem(ROLE_KEY, "admin");
    localStorage.setItem(USERNAME_KEY, nm);
  } catch (e) {}
  unlockApp();
}

function wireLoginScreen(){
  on("roleSalesBtn", "click", showSalesForm);
  on("roleAdminBtn", "click", showAdminForm);
  on("salesBack", "click", function(e){ e.preventDefault(); showRoleChoice(); });
  on("adminBack", "click", function(e){ e.preventDefault(); showRoleChoice(); });
  on("salesPlakaSelect", "change", function(){ trySalesLogin(this.value); });
  on("adminSubmit", "click", tryAdminLogin);
  on("adminPinInput", "keydown", function(e){ if (e.key === "Enter") tryAdminLogin(); });
}

// ---------- Baslangic ----------

watchPlakaConfig();
watchMeta();
watchSofor();
watchBasari();

var alreadyUnlocked = false, savedRole = "", savedUserName = "", savedPlaka = "";
try {
  alreadyUnlocked = localStorage.getItem(UNLOCK_KEY) === "1";
  savedRole = localStorage.getItem(ROLE_KEY) || "";
  savedUserName = localStorage.getItem(USERNAME_KEY) || "";
  savedPlaka = localStorage.getItem(PLAKA_KEY) || "";
} catch (e) {}

console.log("[cariTakip] app.js yuklendi. alreadyUnlocked =", alreadyUnlocked, "rol =", savedRole);

wireLoginScreen();

if (alreadyUnlocked && savedRole === "admin" && savedUserName){
  currentUserName = savedUserName; currentRole = "admin"; unlockApp();
} else if (alreadyUnlocked && savedRole === "sales" && savedPlaka){
  currentRole = "sales";
  currentPlakalar = [savedPlaka === PLAKA_YOK ? PLAKA_YOK : normalizePlate(savedPlaka)];
  unlockApp();
}
