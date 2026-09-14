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
const USERNAME_KEY = "cariTakip_userName_v1";

const COLLECTION_NAME = "cariler";
var cariCollection = null; // ilk kilit acildiginda kurulacak (asagida initRealtime icinde)

var cariler = []; // Firestore'dan gelen canli liste
var currentDocId = null;
var currentUserName = "";

// ---- Ozel takvim durumu ----
var calViewYear, calViewMonth; // takvimde gosterilen ay/yil
var calSelectedISO = ""; // "yyyy-mm-dd" ya da ""

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

  document.getElementById("sumCount").textContent = cariler.length;
  var totalDebt = cariler.reduce(function(s, c){ return s + (c.debt || 0); }, 0);
  document.getElementById("sumDebt").textContent = fmtMoney(totalDebt);
  var flagCount = cariler.filter(function(c){ return c.flagged; }).length;
  document.getElementById("sumFlag").textContent = flagCount;
}

// ---------- Ozel takvim ----------

function pad2(n){ return n < 10 ? "0" + n : "" + n; }

function isoFor(y, m, d){
  return y + "-" + pad2(m + 1) + "-" + pad2(d);
}

var TR_MONTHS = ["Ocak","Subat","Mart","Nisan","Mayis","Haziran","Temmuz","Agustos","Eylul","Ekim","Kasim","Aralik"];

function renderCalendar(){
  var label = document.getElementById("calMonthLabel");
  label.textContent = TR_MONTHS[calViewMonth] + " " + calViewYear;

  var grid = document.getElementById("calGrid");
  grid.innerHTML = "";

  var firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  // Pazartesi=0 ... Pazar=6 olacak sekilde kaydiriyoruz
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
  // popup disina tiklaninca kapat
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
    lastEditedBy: currentUserName,
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

      // merge:true -> mevcut not/tarih/sorunlu/duzenleyen bilgisi silinmez, sadece isim ve bakiye guncellenir
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
  try {
    cariCollection = collection(db, COLLECTION_NAME);
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

  document.getElementById("changeUserLink").addEventListener("click", function(e){
    e.preventDefault();
    var yeni = prompt("Adinizi girin:", currentUserName || "");
    if (yeni !== null && yeni.trim() !== ""){
      currentUserName = yeni.trim();
      try { localStorage.setItem(USERNAME_KEY, currentUserName); } catch (err) {}
      document.getElementById("userNameLabel").textContent = currentUserName;
    }
  });
}

function unlockApp(){
  console.log("[cariTakip] Kilit aciliyor. Kullanici:", currentUserName);
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("locked");
  document.getElementById("userNameLabel").textContent = currentUserName;
  wireEvents();
  initRealtime();
}

function wirePinScreen(){
  console.log("[cariTakip] Giris ekrani hazirlaniyor...");
  var nameInput = document.getElementById("nameInput");
  var pinInput = document.getElementById("pinInput");
  var btn = document.getElementById("pinSubmit");
  var err = document.getElementById("pinError");

  if (!nameInput || !pinInput || !btn || !err){
    console.error("[cariTakip] Giris ekrani elemanlari bulunamadi.");
    return;
  }

  // Daha once girilmis isim varsa on-doldur
  var savedName = "";
  try { savedName = localStorage.getItem(USERNAME_KEY) || ""; } catch (e) {}
  if (savedName) nameInput.value = savedName;

  function tryUnlock(){
    var nm = nameInput.value.trim();
    var pin = pinInput.value;
    console.log("[cariTakip] Giris denendi. isim:", nm, "pin uzunlugu:", pin.length);

    if (!nm){
      err.textContent = "Lutfen isminizi girin.";
      nameInput.focus();
      return;
    }
    if (pin !== APP_PIN){
      err.textContent = "Yanlis PIN.";
      pinInput.value = "";
      pinInput.focus();
      return;
    }

    currentUserName = nm;
    try {
      localStorage.setItem(UNLOCK_KEY, "1");
      localStorage.setItem(USERNAME_KEY, nm);
    } catch (e) {}
    unlockApp();
  }

  btn.addEventListener("click", tryUnlock);
  pinInput.addEventListener("keydown", function(e){
    if (e.key === "Enter") tryUnlock();
  });
  nameInput.addEventListener("keydown", function(e){
    if (e.key === "Enter") pinInput.focus();
  });

  if (savedName) pinInput.focus(); else nameInput.focus();
  console.log("[cariTakip] Giris ekrani hazir.");
}

var alreadyUnlocked = false;
var savedUserName = "";
try {
  alreadyUnlocked = localStorage.getItem(UNLOCK_KEY) === "1";
  savedUserName = localStorage.getItem(USERNAME_KEY) || "";
} catch (e) {}

console.log("[cariTakip] app.js yuklendi. alreadyUnlocked =", alreadyUnlocked, "savedUserName =", savedUserName);

if (alreadyUnlocked && savedUserName){
  currentUserName = savedUserName;
  unlockApp();
} else {
  wirePinScreen();
}
