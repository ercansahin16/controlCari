// app.js — Cari Takip uygulama mantigi (Firestore + rol bazli giris + plaka yonetimi)

import { db } from "./firebase-core.js";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---- Yonetici PIN'i ----
// BURAYI DEGISTIR: kendi PIN'ini yaz. Bu sadece ekrani gizler, gercek
// bir guvenlik degildir (sayfa kaynagina bakan gorebilir).
const ADMIN_PIN = "1234";

const UNLOCK_KEY = "cariTakip_unlocked_v3";
const ROLE_KEY = "cariTakip_role_v3";       // "admin" | "sales"
const USERNAME_KEY = "cariTakip_userName_v3";
const PLAKA_KEY = "cariTakip_plaka_v3";     // plasiyerin sectigi tek plaka

const COLLECTION_NAME = "cariler";
const PLAKA_CONFIG_COLLECTION = "config";
const PLAKA_CONFIG_DOC = "plakalar";

var cariCollection = null;
var plakaDocRef = null;

var cariler = [];
var plakaListesi = []; // yonetici tarafindan tanimlanan gecerli plakalar
var currentDocId = null;
var currentUserName = "";
var currentRole = "";        // "admin" | "sales"
var currentPlakalar = [];    // plasiyerin secili plakasi (tek elemanli dizi)

var calViewYear, calViewMonth;
var calSelectedISO = "";

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

function fmtDateISOtoTR(iso){
  if (!iso) return "";
  var parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return parts[2] + "." + parts[1] + "." + parts[0];
}

function fmtTimestamp(ts){
  if (!ts) return "";
  try {
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

function docIdFor(name){
  var safe = name.toString().trim().replace(/\//g, "_");
  if (safe.length > 400) safe = safe.substring(0, 400);
  return safe;
}

function normalizePlate(p){
  return (p || "").toString().toLocaleUpperCase("tr").replace(/\s+/g, "").trim();
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

// ---------- Plaka konfigurasyonu (herkes icin, sayfa acilir acilmaz dinlenir) ----------

function watchPlakaConfig(){
  try {
    plakaDocRef = doc(db, PLAKA_CONFIG_COLLECTION, PLAKA_CONFIG_DOC);
    onSnapshot(plakaDocRef, function(snap){
      var data = snap.exists() ? snap.data() : {};
      plakaListesi = Array.isArray(data.list) ? data.list.slice() : [];
      plakaListesi.sort(function(a, b){ return a.localeCompare(b, "tr"); });
      populateSalesDropdown();
      renderPlakaManagementList();
    }, function(err){
      console.error("[cariTakip] plaka config dinlenemedi:", err);
    });
  } catch (e) {
    console.error("[cariTakip] plaka config baglanamadi:", e);
  }
}

function populateSalesDropdown(){
  var sel = document.getElementById("salesPlakaSelect");
  if (!sel) return;
  var current = sel.value;
  sel.innerHTML = '<option value="">Plaka secin...</option>';
  plakaListesi.forEach(function(p){
    var opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
  if (current && plakaListesi.indexOf(current) !== -1) sel.value = current;
}

async function addPlaka(){
  var input = document.getElementById("newPlakaInput");
  var status = document.getElementById("plakaStatus");
  var val = input.value.trim();
  if (!val){ status.textContent = "Plaka bos olamaz."; return; }

  var norm = normalizePlate(val);
  var exists = plakaListesi.some(function(p){ return normalizePlate(p) === norm; });
  if (exists){ status.textContent = "Bu plaka zaten listede."; return; }

  status.textContent = "Ekleniyor...";
  try {
    await setDoc(plakaDocRef, { list: arrayUnion(val.toUpperCase().replace(/\s+/g, "")) }, { merge: true });
    input.value = "";
    status.textContent = "Eklendi.";
  } catch (e) {
    status.textContent = "Eklenemedi: " + e.message;
  }
}

async function removePlaka(plaka){
  if (!confirm('"' + plaka + '" plakasini listeden kaldirmak istediginize emin misiniz?')) return;
  var status = document.getElementById("plakaStatus");
  status.textContent = "Kaldiriliyor...";
  try {
    await setDoc(plakaDocRef, { list: arrayRemove(plaka) }, { merge: true });
    status.textContent = "Kaldirildi.";
  } catch (e) {
    status.textContent = "Kaldirilamadi: " + e.message;
  }
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
    btn.addEventListener("click", function(){
      removePlaka(btn.getAttribute("data-plaka"));
    });
  });
}

// ---------- Rol bazli gorunur liste ----------

function getVisibleCariler(){
  if (currentRole === "sales"){
    return cariler.filter(function(c){
      if (!c.plaka) return false;
      var norm = normalizePlate(c.plaka);
      return currentPlakalar.indexOf(norm) !== -1;
    });
  }
  return cariler;
}

function render(){
  var list = document.getElementById("list");
  var q = document.getElementById("searchBox").value.toLocaleLowerCase("tr").trim();

  var visible = getVisibleCariler();
  var filtered = visible.filter(function(c){
    return !q || c.name.toLocaleLowerCase("tr").indexOf(q) !== -1;
  });

  if (visible.length === 0){
    if (currentRole === "sales"){
      list.innerHTML = '<div class="empty">Bu plakaya atanmis cari bulunamadi.<br/>Excelde bu plaka icin cari kategori 5 alani doldurulunca burada gorunecek.</div>';
    } else {
      list.innerHTML = '<div class="empty">Henuz veri yok.<br/>Yukaridan bir Excel dosyasi yukleyin.</div>';
    }
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
      if (c.kategori1 || c.plaka){
        html += '    <div class="tags">';
        if (c.kategori1) html += '<span class="tag">' + escapeHtml(c.kategori1) + '</span>';
        if (c.plaka) html += '<span class="tag">' + escapeHtml(c.plaka) + '</span>';
        html += '    </div>';
      }
      if (c.note){
        html += '    <div class="note-preview">' + escapeHtml(c.note) + '</div>';
      }
      if (c.due){
        html += '    <div class="due">Odeme bekleniyor: ' + escapeHtml(fmtDateISOtoTR(c.due)) + '</div>';
      }
      if (c.lastEditedBy){
        html += '    <div class="editor">Son duzenleyen: ' + escapeHtml(c.lastEditedBy) + (c.lastEditedAtLabel ? " - " + escapeHtml(c.lastEditedAtLabel) : "") + '</div>';
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

  document.getElementById("sumCount").textContent = visible.length;
  var totalDebt = visible.reduce(function(s, c){ return s + (c.debt || 0); }, 0);
  document.getElementById("sumDebt").textContent = fmtMoney(totalDebt);
  var flagCount = visible.filter(function(c){ return c.flagged; }).length;
  document.getElementById("sumFlag").textContent = flagCount;
}

// ---------- Ozel takvim ----------

function pad2(n){ return n < 10 ? "0" + n : "" + n; }
function isoFor(y, m, d){ return y + "-" + pad2(m + 1) + "-" + pad2(d); }

var TR_MONTHS = ["Ocak","Subat","Mart","Nisan","Mayis","Haziran","Temmuz","Agustos","Eylul","Ekim","Kasim","Aralik"];

function renderCalendar(){
  var label = document.getElementById("calMonthLabel");
  label.textContent = TR_MONTHS[calViewMonth] + " " + calViewYear;

  var grid = document.getElementById("calGrid");
  grid.innerHTML = "";

  var firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  var startWeekday = (firstOfMonth.getDay() + 6) % 7;
  var daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  var today = new Date();
  var todayISO = isoFor(today.getFullYear(), today.getMonth(), today.getDate());

  for (var i = 0; i < startWeekday; i++){
    var empty = document.createElement("div");
    empty.className = "empty";
    grid.appendChild(empty);
  }

  for (var d = 1; d <= daysInMonth; d++){
    var cell = document.createElement("div");
    cell.className = "day";
    cell.textContent = d;
    var iso = isoFor(calViewYear, calViewMonth, d);
    if (iso === todayISO) cell.classList.add("today");
    if (iso === calSelectedISO) cell.classList.add("selected");
    cell.addEventListener("click", (function(iso){
      return function(){
        calSelectedISO = iso;
        document.getElementById("dueInput").value = iso;
        document.getElementById("dueDisplay").textContent = fmtDateISOtoTR(iso);
        document.getElementById("dueDisplay").classList.remove("placeholder");
        closeCalendar();
      };
    })(iso));
    grid.appendChild(cell);
  }
}

function openCalendar(){
  var popup = document.getElementById("calendarPopup");
  var iso = document.getElementById("dueInput").value;
  var base = iso ? new Date(iso + "T00:00:00") : new Date();
  calViewYear = base.getFullYear();
  calViewMonth = base.getMonth();
  calSelectedISO = iso || "";
  renderCalendar();
  popup.classList.add("show");
}

function closeCalendar(){
  document.getElementById("calendarPopup").classList.remove("show");
}

function wireCalendar(){
  document.getElementById("dueFieldBtn").addEventListener("click", function(e){
    e.stopPropagation();
    var popup = document.getElementById("calendarPopup");
    if (popup.classList.contains("show")) closeCalendar();
    else openCalendar();
  });
  document.getElementById("calPrev").addEventListener("click", function(e){
    e.stopPropagation();
    calViewMonth--;
    if (calViewMonth < 0){ calViewMonth = 11; calViewYear--; }
    renderCalendar();
  });
  document.getElementById("calNext").addEventListener("click", function(e){
    e.stopPropagation();
    calViewMonth++;
    if (calViewMonth > 11){ calViewMonth = 0; calViewYear++; }
    renderCalendar();
  });
  document.getElementById("calToday").addEventListener("click", function(e){
    e.stopPropagation();
    var today = new Date();
    var iso = isoFor(today.getFullYear(), today.getMonth(), today.getDate());
    calSelectedISO = iso;
    document.getElementById("dueInput").value = iso;
    document.getElementById("dueDisplay").textContent = fmtDateISOtoTR(iso);
    document.getElementById("dueDisplay").classList.remove("placeholder");
    closeCalendar();
  });
  document.getElementById("calClear").addEventListener("click", function(e){
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
    if (!popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)){
      closeCalendar();
    }
  });
}

// ---------- Detay paneli ----------

function openDetail(id){
  currentDocId = id;
  var c = cariler.find(function(x){ return x.id === id; });
  if (!c) return;

  document.getElementById("detailName").textContent = c.name;

  var editorText = c.lastEditedBy
    ? "Son duzenleyen: " + c.lastEditedBy + (c.lastEditedAtLabel ? " - " + c.lastEditedAtLabel : "")
    : "Henuz kimse duzenlemedi.";
  document.getElementById("detailEditor").textContent = editorText;

  var metaParts = [];
  if (c.kategori1) metaParts.push("Bolge: " + c.kategori1);
  if (c.plaka) metaParts.push("Plaka: " + c.plaka);
  document.getElementById("detailMeta").textContent = metaParts.join(" | ") || "-";

  document.getElementById("debtInput").value = c.debt || 0;
  document.getElementById("noteInput").value = c.note || "";

  var iso = c.due || "";
  document.getElementById("dueInput").value = iso;
  var dueDisplay = document.getElementById("dueDisplay");
  if (iso){
    dueDisplay.textContent = fmtDateISOtoTR(iso);
    dueDisplay.classList.remove("placeholder");
  } else {
    dueDisplay.textContent = "Tarih secilmedi";
    dueDisplay.classList.add("placeholder");
  }

  var sw = document.getElementById("flagSwitch");
  sw.classList.toggle("on", !!c.flagged);
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
  return (currentPlakalar[0] || "?") + " (plasiyer)";
}

async function saveCurrentNote(){
  if (!currentDocId) return;
  var status = document.getElementById("saveStatus");
  var debtVal = parseFloat(document.getElementById("debtInput").value);
  if (isNaN(debtVal)) debtVal = 0;

  var data = {
    debt: debtVal,
    note: document.getElementById("noteInput").value,
    due: document.getElementById("dueInput").value,
    flagged: document.getElementById("flagSwitch").classList.contains("on"),
    lastEditedBy: editorLabel(),
    updatedAt: serverTimestamp(),
    lastEditedAt: serverTimestamp()
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

// ---------- Excel yukleme (sadece yonetici) ----------

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

    var kodCol = findCol(headers, ["kod"]);
    var unvanCol = findCol(headers, ["ünvan", "unvan"]);
    if (unvanCol === -1){
      unvanCol = findCol(headers, ["cari isim", "cari ismi", "cari adi", "cari ad"]);
    }
    var kategori1Col = findCol(headers, ["cari kategori 1"]);
    var plakaCol = findCol(headers, ["cari kategori 5"]);
    var debtCol = findCol(headers, ["borç bak", "borc bak", "borç bakiye", "borc bakiye", "bakiye", "kalan", "borç", "borc"]);

    if (unvanCol === -1){
      alert('Excel dosyasinda "Unvan" (veya "Cari Ismi") kolonu bulunamadi.');
      label.textContent = "Excel Yukle (.xlsx)";
      return;
    }

    label.textContent = "Yukleniyor 0/" + (rows.length - 1);
    var count = 0;
    var total = rows.length - 1;
    var yeniPlakalar = {};

    for (var i = 1; i < rows.length; i++){
      var r = rows[i];
      var nm = (r[unvanCol] || "").toString().trim();
      if (!nm) continue;

      var kod = kodCol !== -1 ? (r[kodCol] || "").toString().trim() : "";
      var kategori1 = kategori1Col !== -1 ? (r[kategori1Col] || "").toString().trim() : "";
      var plaka = plakaCol !== -1 ? (r[plakaCol] || "").toString().trim() : "";
      var debt = debtCol !== -1 ? parseNumber(r[debtCol]) : 0;

      var id = kod ? docIdFor(kod) : docIdFor(nm);

      await setDoc(doc(db, COLLECTION_NAME, id), {
        name: nm,
        kod: kod,
        kategori1: kategori1,
        plaka: plaka,
        debt: debt,
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (plaka) yeniPlakalar[normalizePlate(plaka)] = plaka.toUpperCase().replace(/\s+/g, "");

      count++;
      label.textContent = "Yukleniyor " + count + "/" + total;
    }

    // Excel'deki plakalari otomatik olarak plaka listesine ekle (plasiyer dropdown'inda gorunsun diye)
    var mevcutNorm = plakaListesi.map(function(p){ return normalizePlate(p); });
    var eklenecekler = [];
    Object.keys(yeniPlakalar).forEach(function(norm){
      if (mevcutNorm.indexOf(norm) === -1) eklenecekler.push(yeniPlakalar[norm]);
    });
    if (eklenecekler.length > 0 && plakaDocRef){
      try {
        await setDoc(plakaDocRef, { list: arrayUnion.apply(null, eklenecekler) }, { merge: true });
      } catch (e) {
        console.error("[cariTakip] plaka listesi guncellenemedi:", e);
      }
    }

    label.textContent = "Excel Yukle (.xlsx)";
  } catch (err) {
    alert("Dosya okunurken hata olustu: " + err.message);
    label.textContent = "Excel Yukle (.xlsx)";
  }
}

// ---------- Firestore canli baglanti (cariler) ----------

function initRealtime(){
  setConnStatus("Baglaniyor...", false);
  try {
    cariCollection = collection(db, COLLECTION_NAME);
    onSnapshot(cariCollection, function(snapshot){
      cariler = [];
      snapshot.forEach(function(docSnap){
        var d = docSnap.data();
        cariler.push({
          id: docSnap.id,
          name: d.name || docSnap.id,
          kategori1: d.kategori1 || "",
          plaka: d.plaka || "",
          debt: d.debt || 0,
          note: d.note || "",
          due: d.due || "",
          flagged: !!d.flagged,
          lastEditedBy: d.lastEditedBy || "",
          lastEditedAtLabel: fmtTimestamp(d.lastEditedAt)
        });
      });
      setConnStatus("Canli baglanti aktif", true);
      render();
    }, function(error){
      console.error("Firestore onSnapshot hatasi:", error);
      setConnStatus("Baglanti hatasi: " + error.message, false);
    });
  } catch (e) {
    console.error("Firestore baglanti kurulamadi:", e);
    setConnStatus("Baglanti kurulamadi: " + e.message, false);
  }
}

// ---------- Hamburger menu ----------

function wireHamburger(){
  var btn = document.getElementById("hamburgerBtn");
  var menu = document.getElementById("hamburgerMenu");

  btn.addEventListener("click", function(e){
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", function(e){
    if (!menu.contains(e.target) && e.target !== btn){
      menu.classList.add("hidden");
    }
  });

  document.getElementById("menuLogout").addEventListener("click", function(e){
    e.preventDefault();
    logout();
  });

  document.getElementById("menuPlakaYonetimi").addEventListener("click", function(e){
    e.preventDefault();
    menu.classList.add("hidden");
    if (currentRole !== "admin"){
      alert("Plaka yonetimi sadece yoneticiler icindir.");
      return;
    }
    renderPlakaManagementList();
    document.getElementById("plakaStatus").textContent = "";
    document.getElementById("plakaOverlay").classList.add("show");
  });

  document.getElementById("closePlakaBtn").addEventListener("click", function(){
    document.getElementById("plakaOverlay").classList.remove("show");
  });
  document.getElementById("plakaOverlay").addEventListener("click", function(e){
    if (e.target === this) this.classList.remove("show");
  });
  document.getElementById("addPlakaBtn").addEventListener("click", addPlaka);
  document.getElementById("newPlakaInput").addEventListener("keydown", function(e){
    if (e.key === "Enter") addPlaka();
  });

  // plasiyer rolunde plaka yonetimi menu ogesini gizle
  if (currentRole !== "admin"){
    document.getElementById("menuPlakaYonetimi").classList.add("hidden");
  }
}

// ---------- Olay baglama ----------

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
  wireCalendar();
  wireHamburger();
}

function logout(){
  try {
    localStorage.removeItem(UNLOCK_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(PLAKA_KEY);
  } catch (e) {}
  location.reload();
}

function applyRoleUI(){
  var uploadRow = document.getElementById("uploadRow");
  var deleteBtn = document.getElementById("deleteBtn");
  var userInfo = document.getElementById("userInfo");

  if (currentRole === "admin"){
    uploadRow.classList.remove("hidden");
    deleteBtn.classList.remove("hidden");
    userInfo.innerHTML = 'Yonetici: <b>' + escapeHtml(currentUserName) + '</b>';
  } else {
    uploadRow.classList.add("hidden");
    deleteBtn.classList.add("hidden");
    userInfo.innerHTML = 'Plasiyer: <b>' + escapeHtml(currentPlakalar[0] || "") + '</b>';
  }
}

function unlockApp(){
  console.log("[cariTakip] Kilit aciliyor. Rol:", currentRole, "Kullanici:", currentUserName, "Plaka:", currentPlakalar);
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("locked");
  applyRoleUI();
  wireEvents();
  initRealtime();
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
  currentPlakalar = [normalizePlate(plaka)];
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

  currentUserName = nm;
  currentRole = "admin";
  currentPlakalar = [];

  try {
    localStorage.setItem(UNLOCK_KEY, "1");
    localStorage.setItem(ROLE_KEY, "admin");
    localStorage.setItem(USERNAME_KEY, nm);
  } catch (e) {}

  unlockApp();
}

function wireLoginScreen(){
  document.getElementById("roleSalesBtn").addEventListener("click", showSalesForm);
  document.getElementById("roleAdminBtn").addEventListener("click", showAdminForm);
  document.getElementById("salesBack").addEventListener("click", function(e){ e.preventDefault(); showRoleChoice(); });
  document.getElementById("adminBack").addEventListener("click", function(e){ e.preventDefault(); showRoleChoice(); });

  document.getElementById("salesPlakaSelect").addEventListener("change", function(){
    trySalesLogin(this.value);
  });

  document.getElementById("adminSubmit").addEventListener("click", tryAdminLogin);
  document.getElementById("adminPinInput").addEventListener("keydown", function(e){
    if (e.key === "Enter") tryAdminLogin();
  });
}

// ---------- Baslangic ----------

watchPlakaConfig(); // plaka listesini sayfa acilir acilmaz dinlemeye basla (giris ekrani icin de gerekli)

var alreadyUnlocked = false;
var savedRole = "";
var savedUserName = "";
var savedPlaka = "";
try {
  alreadyUnlocked = localStorage.getItem(UNLOCK_KEY) === "1";
  savedRole = localStorage.getItem(ROLE_KEY) || "";
  savedUserName = localStorage.getItem(USERNAME_KEY) || "";
  savedPlaka = localStorage.getItem(PLAKA_KEY) || "";
} catch (e) {}

console.log("[cariTakip] app.js yuklendi. alreadyUnlocked =", alreadyUnlocked, "rol =", savedRole);

wireLoginScreen();

if (alreadyUnlocked && savedRole === "admin" && savedUserName){
  currentUserName = savedUserName;
  currentRole = "admin";
  unlockApp();
} else if (alreadyUnlocked && savedRole === "sales" && savedPlaka){
  currentRole = "sales";
  currentPlakalar = [normalizePlate(savedPlaka)];
  unlockApp();
}
