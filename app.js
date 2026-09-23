<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>LED Saha</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>%E2%9A%A1</text></svg>" />

<!-- PWA -->
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#0f1115" />
<link rel="apple-touch-icon" href="icons/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="LED Saha" />
<script>
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (e) {
        console.error("[cariTakip] service worker kaydedilemedi:", e);
      });
    });
  }
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<style>
  :root{
    --bg:#0f1115; --card:#1a1d24; --card2:#20242c; --border:#2a2f3a;
    --text:#e7e9ee; --muted:#8b93a3; --accent:#5b8dee; --danger:#e5566d;
    --danger-bg:#2a1820; --ok:#3fbf7f; --ok-bg:#0f2b1e; --warn:#e0a83f;
  }
  *{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
  html, body{ touch-action: manipulation; }
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    font-size:12.5px; max-width:480px; margin:0 auto; padding-bottom:24px;
  }
  .topbar{ position:sticky; top:0; z-index:5; background:var(--bg); padding:10px 12px 8px 12px; border-bottom:1px solid var(--border); }
  .topbar-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; position:relative; }
  .topbar h1{ font-size:15px; margin:0; font-weight:700; letter-spacing:.2px; flex:1; }
  .icon-btn{
    background:var(--card); border:1px solid var(--border); color:var(--text);
    width:30px; height:30px; border-radius:9px; font-size:14px;
    cursor:pointer; display:flex; align-items:center; justify-content:center; position:relative; flex-shrink:0;
  }
  .icon-btn .badge{
    position:absolute; top:-6px; right:-6px; background:var(--danger); color:#fff;
    font-size:9px; font-weight:700; border-radius:10px; min-width:16px; height:16px;
    padding:0 3px; display:flex; align-items:center; justify-content:center; line-height:1;
  }
  .icon-btn .badge.hidden{ display:none; }
  #hamburgerMenu{
    position:absolute; top:36px; right:0; z-index:40; background:var(--card);
    border:1px solid var(--border); border-radius:10px; min-width:190px;
    box-shadow:0 10px 28px rgba(0,0,0,.45); overflow:hidden;
  }
  #hamburgerMenu.hidden{ display:none; }
  #hamburgerMenu a{ display:block; padding:10px 12px; font-size:12px; color:var(--text); text-decoration:none; border-bottom:1px solid var(--border); }
  #hamburgerMenu a:last-child{ border-bottom:none; }
  #hamburgerMenu a.danger{ color:var(--danger); }
  #userInfo{ font-size:10px; color:var(--muted); margin:6px 0; }
  #userInfo b{ color:var(--text); }
  #connStatus{ font-size:10px; margin:0 0 8px 0; color:var(--warn); }
  .upload-row{ display:flex; gap:6px; align-items:center; }
  .upload-btn{ flex:1; background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 10px; font-size:12px; font-weight:600; text-align:center; display:block; }
  input[type=file]{ display:none; }
  .required-cols{ font-size:9px; color:var(--muted); margin-top:5px; line-height:1.4; }
  .search{ width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; padding:7px 9px; color:var(--text); font-size:12px; }
  .search-wrap{ display:flex; gap:6px; margin-top:8px; }
  .search-wrap .search{ flex:1; }
  .search-clear-btn{ display:none; background:var(--card2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:0 12px; font-size:11.5px; cursor:pointer; white-space:nowrap; }
  .search-clear-btn.show{ display:block; }
  .summary{ display:flex; gap:6px; margin-top:8px; }
  .chip{ flex:1; background:var(--card); border:1px solid var(--border); border-radius:8px; padding:6px 8px; text-align:center; }
  .chip.clickable{ cursor:pointer; }
  .chip.active{ border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
  .chip .n{ font-size:13px; font-weight:700; display:block; }
  .chip .l{ font-size:10px; color:var(--muted); }
  #cariCountLabel{ font-size:10px; color:var(--muted); font-weight:400; }
  .list{ padding:8px 10px; }
  .empty{ color:var(--muted); text-align:center; padding:40px 20px; font-size:12px; line-height:1.6; }
  .row{ background:var(--card); border:1px solid var(--border); border-radius:10px; padding:9px 10px; margin-bottom:7px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .row.flagged{ border-color:var(--danger); background:var(--danger-bg); }
  .row.due-alert{ box-shadow:0 0 0 1px #b026ff, 0 0 14px rgba(176,38,255,.65); }
  .row.paid{ border-color:var(--ok); }
  .row .left{ min-width:0; flex:1; }
  .row .name{ font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row .tags{ margin-top:2px; }
  .row .tag{ display:inline-block; font-size:9px; color:var(--muted); background:var(--card2); border:1px solid var(--border); border-radius:5px; padding:1px 5px; margin-right:4px; }
  .row .note-preview{ font-size:10.5px; color:var(--danger); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row .sabitnot-preview{ font-size:10.5px; color:var(--accent); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row .due{ font-size:10px; color:var(--warn); margin-top:2px; }
  .row .editor{ font-size:9.5px; color:var(--accent); margin-top:2px; cursor:pointer; text-decoration:underline dotted; }
  .row .paidline{ font-size:10.5px; color:var(--ok); margin-top:2px; font-weight:600; }
  .row .right{ text-align:right; flex-shrink:0; }
  .row .debt{ font-size:13px; font-weight:700; }
  .row .debt.zero{ color:var(--ok); }
  .row .badgetxt{ font-size:9px; color:var(--muted); margin-top:2px; }
  .overlay{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:none; align-items:flex-end; z-index:20; }
  .overlay.show{ display:flex; }
  .sheet{
    background:var(--card); width:100%; border-radius:14px 14px 0 0;
    max-height:88vh; display:flex; flex-direction:column; overflow:hidden;
  }
  .sheet-head{ padding:14px 14px 6px 14px; flex-shrink:0; }
  .sheet-head h2{ font-size:13.5px; margin:0 0 2px 0; }
  .sheet-head .sub{ font-size:10.5px; color:var(--muted); }
  #detailEditor{ cursor:pointer; text-decoration:underline dotted; color:var(--accent); }
  .sheet-body{ padding:8px 14px; overflow-y:auto; flex:1; min-height:0; }
  .sheet-footer{ padding:10px 14px 16px 14px; flex-shrink:0; border-top:1px solid var(--border); }
  .field{ margin-bottom:9px; }
  .field label{ display:block; font-size:10.5px; color:var(--muted); margin-bottom:3px; }
  .field textarea, .field input[type=date]{ width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:7px; font-size:12px; font-family:inherit; }
  .field textarea{ min-height:52px; resize:vertical; }
  .field input[type=number]{ width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:7px; font-size:13px; font-family:inherit; }
  .field input[type=text]{ width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:7px; font-size:13px; font-family:inherit; }

  .date-field-wrap{ position:relative; }
  .date-field{ width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:7px; font-size:12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; }
  .date-field .placeholder{ color:var(--muted); }
  .calendar-popup{ display:none; position:absolute; bottom:calc(100% + 4px); left:0; right:0; background:var(--card2); border:1px solid var(--border); border-radius:10px; padding:8px; z-index:30; box-shadow:0 8px 24px rgba(0,0,0,.4); }
  .calendar-popup.show{ display:block; }
  .cal-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; font-size:12px; font-weight:600; }
  .cal-header button{ background:none; border:none; color:var(--text); font-size:16px; padding:2px 8px; cursor:pointer; }
  .cal-weekdays, .cal-grid{ display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; text-align:center; }
  .cal-weekdays div{ font-size:9px; color:var(--muted); padding:2px 0; }
  .cal-grid div{ font-size:11px; padding:6px 0; border-radius:6px; cursor:pointer; }
  .cal-grid div.empty{ cursor:default; }
  .cal-grid div.today{ border:1px solid var(--accent); }
  .cal-grid div.selected{ background:var(--accent); color:#fff; font-weight:700; }
  .cal-footer{ display:flex; gap:6px; margin-top:6px; }
  .cal-footer button{ flex:1; background:var(--card); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:6px; font-size:10.5px; cursor:pointer; }

  .toggle-row{ display:flex; align-items:center; justify-content:space-between; background:var(--card2); border:1px solid var(--border); border-radius:8px; padding:7px 10px; margin-bottom:9px; }
  .toggle-row span{ font-size:11.5px; }
  .switch{ width:36px; height:20px; background:#3a3f4a; border-radius:12px; position:relative; cursor:pointer; flex-shrink:0; }
  .switch.on{ background:var(--danger); }
  .switch.on.paidsw{ background:var(--ok); }
  .switch .dot{ width:16px; height:16px; background:#fff; border-radius:50%; position:absolute; top:2px; left:2px; transition:left .15s; }
  .switch.on .dot{ left:18px; }
  .paid-amount-row{ display:none; margin-top:8px; }
  .paid-amount-row.show{ display:block; }

  .btn-row{ display:flex; gap:8px; }
  .btn{ flex:1; border:none; border-radius:8px; padding:10px; font-size:12px; font-weight:600; }
  .btn.save{ background:var(--accent); color:#fff; }
  .btn.clear{ background:var(--warn); color:#2a1c00; }
  .btn.close{ background:var(--card2); color:var(--text); border:1px solid var(--border); }
  .btn.delete{ background:var(--danger-bg); color:var(--danger); border:1px solid var(--danger); flex:0 0 auto; padding:10px 12px; }
  .status{ font-size:10.5px; color:var(--muted); text-align:center; padding:4px 0 0 0; }

  /* Excel yukleme modali */
  .upload-icon{ font-size:38px; text-align:center; margin-bottom:4px; }
  .upload-progress-wrap{ background:var(--card2); border-radius:8px; height:10px; overflow:hidden; margin:10px 0 6px 0; }
  .upload-progress-bar{ height:100%; width:0%; background:var(--accent); transition:width .2s; }
  .upload-progress-text{ font-size:11.5px; color:var(--muted); text-align:center; }
  .upload-summary{ font-size:12px; margin-top:12px; line-height:1.7; }
  .upload-summary .line{ display:flex; justify-content:space-between; padding:5px 8px; background:var(--card2); border-radius:6px; margin-bottom:5px; }
  .upload-summary .line b{ color:var(--text); }
  .upload-btn.disabled{ opacity:.5; pointer-events:none; }

  #lockScreen{ position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:50; padding:24px; }
  #lockScreen.hidden{ display:none; }
  .lock-box{ width:100%; max-width:280px; text-align:center; }
  .lock-box h2{ font-size:15px; margin:0 0 4px 0; }
  .lock-box p{ font-size:11px; color:var(--muted); margin:0 0 16px 0; }
  .lock-box input, .lock-box select{ width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:11px; font-size:15px; text-align:center; margin-bottom:10px; }
  .lock-box button{ width:100%; background:var(--accent); color:#fff; border:none; border-radius:8px; padding:11px; font-size:13px; font-weight:600; }
  .lock-box .err{ color:var(--danger); font-size:11px; margin-top:8px; min-height:14px; }
  #appRoot.locked{ display:none; }
  .hidden{ display:none !important; }
  .role-btn{ width:100%; border:none; border-radius:8px; padding:13px; font-size:13px; font-weight:700; margin-bottom:10px; cursor:pointer; }
  .role-btn.sales{ background:var(--ok); color:#06281a; }
  .role-btn.admin{ background:var(--accent); color:#fff; }
  .role-form p{ font-size:12px; color:var(--text); font-weight:600; margin:0 0 10px 0; }
  .back-link{ display:block; font-size:11px; color:var(--muted); margin-top:8px; text-decoration:none; }

  .plaka-list{ margin:6px 0 12px 0; }
  .plaka-item{ display:flex; justify-content:space-between; align-items:center; background:var(--card2); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:6px; font-size:12px; }
  .plaka-item button{ background:var(--danger-bg); color:var(--danger); border:1px solid var(--danger); border-radius:6px; padding:4px 9px; font-size:11px; cursor:pointer; }
  .plaka-add-row{ display:flex; gap:6px; }
  .plaka-add-row input{ flex:1; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:9px; font-size:12px; }
  .plaka-add-row button{ background:var(--accent); color:#fff; border:none; border-radius:8px; padding:9px 14px; font-size:12px; font-weight:600; cursor:pointer; }

  .review-item{ background:var(--card2); border:1px solid var(--border); border-radius:8px; padding:9px 10px; margin-bottom:7px; }
  .review-item .rname{ font-size:12px; font-weight:600; }
  .review-item .rmeta{ font-size:10px; color:var(--muted); margin-top:2px; }
  .review-item .ramount{ font-size:13px; font-weight:700; color:var(--ok); margin-top:4px; }
  .review-item .ractions{ display:flex; gap:6px; margin-top:8px; }
  .review-item .ractions button{ flex:1; border:none; border-radius:6px; padding:7px; font-size:10.5px; font-weight:600; cursor:pointer; }
  .review-item .ractions .approve{ background:var(--ok-bg); color:var(--ok); border:1px solid var(--ok); }
  .review-item .ractions .reject{ background:var(--warn); color:#2a1c00; border:1px solid var(--warn); }
  .review-item .ractions .cancel{ background:var(--card); color:var(--text); border:1px solid var(--border); }
  .row .rejectline{ font-size:10.5px; color:var(--warn); margin-top:2px; }

  .filter-row{ display:flex; gap:6px; margin-top:8px; }
  .filter-item{ position:relative; flex:1; }
  .filter-item select{ width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:6px; font-size:11px; }
  .filter-clear-x{ display:none !important; position:absolute; right:5px; top:50%; transform:translateY(-50%); background:var(--card); border:1px solid var(--border); color:var(--muted); width:16px; height:16px; border-radius:50%; font-size:10px; line-height:1; cursor:pointer; align-items:center; justify-content:center; }
  .filters-clear-all{ display:none; width:100%; margin-top:8px; background:var(--card2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:8px; font-size:11.5px; cursor:pointer; }
  .filters-clear-all.show{ display:block; }

  .sofor-item{ display:flex; gap:6px; align-items:center; background:var(--card2); border:1px solid var(--border); border-radius:8px; padding:8px; margin-bottom:6px; }
  .sofor-item .plaka{ font-size:11px; font-weight:600; flex:0 0 88px; }
  .sofor-item input{ flex:1; background:var(--card); border:1px solid var(--border); border-radius:6px; color:var(--text); padding:6px; font-size:11px; }
  .sofor-item button{ background:var(--accent); color:#fff; border:none; border-radius:6px; padding:6px 9px; font-size:10.5px; cursor:pointer; }

  .basari-box{ text-align:center; padding:10px 4px 4px 4px; }
  .basari-box .trophy{ font-size:44px; margin-bottom:8px; }
  .basari-box .plate{ font-size:17px; font-weight:800; }
  .basari-box .sofor{ font-size:13px; color:var(--muted); margin-top:2px; }
  .basari-box .amount{ font-size:20px; font-weight:800; color:var(--ok); margin-top:10px; }
  .basari-box .caption{ font-size:10.5px; color:var(--muted); margin-top:6px; }

  .tab-row{ display:flex; flex-wrap:wrap; gap:6px; }
  .tab-btn{ background:var(--card2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:7px 11px; font-size:11px; cursor:pointer; }
  .tab-btn.active{ background:var(--accent); color:#fff; border-color:var(--accent); }
  .inline-input-row{ display:none; gap:6px; margin-top:8px; }
  .inline-input-row.show{ display:flex; }
  .inline-input-row input{ flex:1; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:8px; font-size:12px; }
  .inline-input-row button{ background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 14px; font-size:12px; font-weight:600; cursor:pointer; }

  .trend-bars{ display:flex; gap:6px; overflow-x:auto; padding-bottom:4px; align-items:flex-end; }
  .trend-col{ display:flex; flex-direction:column; align-items:center; flex:0 0 auto; width:36px; }
  .trend-val{ font-size:7.5px; color:var(--muted); margin-bottom:2px; white-space:nowrap; }
  .trend-bar-wrap{ height:90px; width:18px; background:var(--card2); border-radius:4px; display:flex; align-items:flex-end; overflow:hidden; }
  .trend-bar{ width:100%; border-radius:4px 4px 0 0; }
  .trend-bar.pos{ background:var(--ok); }
  .trend-bar.neg{ background:var(--danger); }
  .trend-label{ font-size:8px; color:var(--muted); margin-top:3px; }
  .trend-summary{ margin-top:14px; font-size:12px; text-align:center; background:var(--card2); border-radius:8px; padding:9px; }
  .filter-notice{ font-size:10.5px; color:var(--warn); background:var(--card2); border:1px solid var(--warn); border-radius:8px; padding:7px 9px; margin-bottom:10px; }
  .filter-notice:empty{ display:none; }
  .date-range-row{ display:flex; gap:6px; align-items:center; }
  .date-range-row input[type=date]{ flex:1; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:8px; font-size:11.5px; }
  .date-range-row button{ background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 12px; font-size:12px; font-weight:600; cursor:pointer; }

  #customModalMessage{ font-size:12.5px; line-height:1.6; white-space:pre-line; }
  #customModalInput{ margin-top:10px; width:100%; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:9px; font-size:12px; }

  .history-item{ background:var(--card2); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:6px; }
  .history-item .hname{ font-size:11.5px; font-weight:600; }
  .history-item .hmeta{ font-size:9.5px; color:var(--accent); margin-top:2px; }
  .history-item .hnote{ font-size:10.5px; color:var(--text); margin-top:3px; }
  .history-item.read{ opacity:.55; }
  .history-item.read .hname, .history-item.read .hnote{ color:var(--muted); }

  #nightLock{ position:fixed; inset:0; background:var(--bg); z-index:60; display:none; align-items:center; justify-content:center; padding:28px; text-align:center; }
  #nightLock.show{ display:flex; }
  #nightLock .box{ max-width:280px; }
  #nightLock .icon{ font-size:34px; margin-bottom:10px; }
  #nightLock h3{ font-size:14px; margin:0 0 8px 0; }
  #nightLock p{ font-size:12px; color:var(--muted); line-height:1.6; }

  /* ---- Masaustu gorunumu (mobil bu bolumden etkilenmez) ---- */
  @media (min-width: 900px){
    body{ max-width: 1100px; font-size: 13.5px; }
    .topbar{ padding: 18px 28px 14px 28px; }
    .topbar h1{ font-size: 21px; }
    #cariCountLabel{ font-size: 13px; }
    .icon-btn{ width: 36px; height: 36px; font-size: 16px; }

    /* Durum satirlarini (yonetici, alt limit, veri tarihi, baglanti) tek satirda topla */
    .status-line-group{
      display:flex; flex-wrap:wrap; align-items:center; gap:4px 16px;
      margin: 4px 0 12px 0; padding-bottom:10px; border-bottom:1px solid var(--border);
    }
    .status-line-group > div{ margin:0 !important; font-size:11.5px; white-space:nowrap; }
    #connStatus{ font-weight:600; }

    /* Yukleme + arama + filtreleri yan yana tek satira al */
    .controls-row{ display:flex; align-items:flex-start; gap:16px; flex-wrap:wrap; }
    .upload-row{ flex:0 0 220px; }
    .upload-btn{ padding: 10px 12px; font-size: 12.5px; }
    .required-cols{ flex-basis:100%; order:5; font-size: 10px; margin-top:-6px; }
    .search-wrap{ flex:0 0 260px; margin-top:0; }
    .search{ padding: 9px 11px; font-size: 12.5px; }
    .filter-row{ flex:1 1 320px; margin-top:0; min-width:280px; }
    .filter-row select{ padding: 8px; font-size: 12px; }
    .filters-clear-all{ display:none !important; }
    .filter-clear-x.show{ display:flex !important; }

    .summary{ max-width: 640px; margin-top:14px; }
    .chip{ padding: 12px 14px; }
    .chip .n{ font-size: 17px; }
    .chip .l{ font-size: 11.5px; }
    .list{
      padding: 16px 28px 28px 28px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .row{ margin-bottom: 0; padding: 14px 16px; transition: transform .12s, border-color .12s; }
    .row:hover{ border-color: var(--accent); transform: translateY(-2px); cursor: pointer; }
    .row .name{ font-size: 14px; }
    .row .debt{ font-size: 15px; }
    .empty{ grid-column: 1 / -1; }

    /* Modallari asagidan acilan sheet yerine ortalanmis dialog gibi goster */
    .overlay{ align-items: center; justify-content: center; }
    .sheet{ max-width: 480px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
    #nightBypassOverlay{ align-items: center; justify-content: center; }

    .lock-box{ max-width: 340px; }
  }
</style>
</head>
<body>

<div id="lockScreen">
  <div class="lock-box">
    <h2>LED Saha</h2>
    <div id="roleChoice">
      <p style="font-size:11px;color:var(--muted);margin:0 0 14px 0;">Giris turunu secin</p>
      <button type="button" class="role-btn sales" id="roleSalesBtn">Plasiyer Girisi</button>
      <button type="button" class="role-btn admin" id="roleAdminBtn">Yonetici Girisi</button>
    </div>
    <div id="salesForm" class="role-form hidden">
      <p>Plasiyer Girisi</p>
      <select id="salesPlakaSelect"><option value="">Plaka secin...</option></select>
      <input type="password" inputmode="numeric" id="salesPinInput" placeholder="PIN" maxlength="12" class="hidden" />
      <button type="button" id="salesSubmitBtn" class="hidden">Giris</button>
      <a href="#" class="back-link" id="salesBack">‹ Geri</a>
    </div>
    <div id="adminForm" class="role-form hidden">
      <p>Yonetici Girisi</p>
      <select id="adminNameSelect"><option value="">Isim secin...</option></select>
      <input type="password" id="adminPinInput" placeholder="Sifre" maxlength="16" />
      <button type="button" id="adminSubmit">Giris</button>
      <a href="#" class="back-link" id="adminBack">‹ Geri</a>
    </div>
    <div class="err" id="pinError"></div>
  </div>
</div>

<div id="nightLock">
  <div class="box">
    <div class="icon">🌙</div>
    <h3 id="nightLockTitle">Gece Kilidi Aktif</h3>
    <p>Gece 01:00'den sonra veriler kilitlenir.<br/>Lutfen muhasebeden guncel veri yuklemesini isteyin. Yukleme yapilinca bu ekran otomatik acilacaktir.</p>
  </div>
</div>

<div class="overlay" id="nightBypassOverlay" style="align-items:center; justify-content:center; z-index:70;">
  <div style="background:var(--card); border-radius:12px; padding:14px; display:flex; gap:8px; align-items:center;">
    <input type="password" inputmode="numeric" id="nightBypassInput" style="width:140px; background:var(--card2); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:10px; font-size:16px; text-align:center; letter-spacing:3px;" />
    <button type="button" id="nightBypassSubmitBtn" style="background:var(--accent); color:#fff; border:none; border-radius:8px; padding:10px 14px; font-size:15px; cursor:pointer;">✓</button>
  </div>
</div>

<div id="appRoot" class="locked">
<div class="topbar">
  <div class="topbar-head">
    <h1>LED Saha <span id="cariCountLabel">(0)</span></h1>
    <button class="icon-btn" id="paymentIconBtn">💰<span class="badge hidden" id="paymentBadge">0</span></button>
    <button class="icon-btn" id="dueAlertBtn">🔔<span class="badge hidden" id="dueAlertBadge">0</span></button>
    <button class="icon-btn" id="hamburgerBtn">☰</button>
    <div id="hamburgerMenu" class="hidden">
      <a href="#" id="menuTahsilatDurumu">📊 Tahsilat Durumu</a>
      <a href="#" id="menuOdemeBekleyen">⏰ Odeme Bekleyenler</a>
      <a href="#" id="menuTrend">📈 Tahsilat Trendi</a>
      <a href="#" id="menuAltLimit">💵 Alt Limit Belirle</a>
      <a href="#" id="menuSifremDegistir">🔑 Sifremi Degistir</a>
      <a href="#" id="menuPlasiyerSifresi">🔑 Plasiyer Sifresini Degistir</a>
      <a href="#" id="menuKullaniciTanimlama">👥 Kullanici Tanimlama</a>
      <a href="#" id="menuPlakaDegistir">🔄 Plaka Degistir</a>
      <a href="#" id="menuSoforTanimlama">🧑‍✈️ Sofor Tanimlama</a>
      <a href="#" id="menuBasari">🏆 Dunun Basarisi</a>
      <a href="#" id="menuPlakaYonetimi">🚚 Plaka Yonetimi</a>
      <a href="#" id="menuGecmis">📜 Gecmis</a>
      <a href="#" id="menuLogout" class="danger">🚪 Cikis</a>
    </div>
  </div>
  <div class="status-line-group" id="statusLineGroup">
    <div id="userInfo">-</div>
    <div id="minBakiyeLabel" style="font-size:10px;color:var(--muted);margin-bottom:4px;"></div>
    <div id="veriTarihiLabel" style="font-size:10px;color:var(--muted);margin-bottom:4px;"></div>
    <div id="connStatus">Baglaniyor...</div>
  </div>
  <div class="controls-row" id="controlsRow">
    <div class="upload-row" id="uploadRow">
      <label class="upload-btn" for="fileInput" id="uploadLabel">Excel Yukle (.xlsx)</label>
      <input type="file" id="fileInput" accept=".xlsx,.xls" />
    </div>
    <div class="required-cols" id="requiredCols"></div>
    <div class="search-wrap">
      <input class="search" id="searchBox" placeholder="Cari ara..." />
      <button type="button" class="search-clear-btn" id="searchClearBtn">Temizle</button>
    </div>
    <div class="filter-row hidden" id="adminFilterRow">
      <div class="filter-item">
        <select id="filterKategori1"><option value="">Tum Bolgeler</option></select>
        <button type="button" class="filter-clear-x" id="clearKategori1Btn">✕</button>
      </div>
      <div class="filter-item">
        <select id="filterPlaka"><option value="">Tum Plakalar</option></select>
        <button type="button" class="filter-clear-x" id="clearPlakaBtn">✕</button>
      </div>
    </div>
    <button type="button" class="filters-clear-all" id="clearAllFiltersBtn">🧹 Filtreleri Temizle</button>
  </div>
  <div class="summary">
    <div class="chip clickable" id="chipNoted"><span class="n" id="sumNoted">0</span><span class="l">Not Olan</span></div>
    <div class="chip"><span class="n" id="sumDebt">0</span><span class="l">Toplam Bakiye</span></div>
    <div class="chip clickable" id="chipFlag"><span class="n" id="sumFlag">0</span><span class="l">Sorunlu</span></div>
  </div>
</div>

<div class="list" id="list">
  <div class="empty">Henuz veri yok.<br/>Yukaridan bir Excel dosyasi yukleyin.</div>
</div>

<div class="overlay" id="overlay">
  <div class="sheet">
    <div class="sheet-head">
      <h2 id="detailName">-</h2>
      <div class="sub" id="detailEditor">-</div>
      <div class="sub" id="detailMeta">-</div>
    </div>
    <div class="sheet-body">
      <div class="field">
        <label>Kalan Bakiye</label>
        <input type="text" inputmode="decimal" id="debtInput" />
      </div>

      <div class="toggle-row">
        <span>✅ Odeme Alindi</span>
        <div class="switch" id="paidSwitch"><div class="dot"></div></div>
      </div>
      <div class="paid-amount-row field" id="paidAmountRow">
        <label>Alinan Tutar</label>
        <input type="text" inputmode="decimal" id="paidAmountInput" placeholder="0,00" />
      </div>

      <div class="toggle-row">
        <span>Sorunlu / Odeme problemi var</span>
        <div class="switch" id="flagSwitch"><div class="dot"></div></div>
      </div>

      <div class="field">
        <label>Sabit (Not)</label>
        <textarea id="sabitNotInput" placeholder="Ornek: Her ayin 20'sinde odeme yapiyor."></textarea>
      </div>

      <div class="field">
        <label>Gecici (Not)</label>
        <textarea id="noteInput" placeholder="Ornek: Ay basinda odeyecegini soyledi."></textarea>
      </div>

      <div class="field date-field-wrap">
        <label>Odeme Beklenen Tarih</label>
        <div class="date-field" id="dueFieldBtn">
          <span id="dueDisplay" class="placeholder">Tarih secilmedi</span>
          <span>📅</span>
        </div>
        <input type="hidden" id="dueInput" />
        <div class="calendar-popup" id="calendarPopup">
          <div class="cal-header">
            <button type="button" id="calPrev">‹</button>
            <span id="calMonthLabel"></span>
            <button type="button" id="calNext">›</button>
          </div>
          <div class="cal-weekdays"><div>Pt</div><div>Sa</div><div>Ca</div><div>Pe</div><div>Cu</div><div>Ct</div><div>Pz</div></div>
          <div class="cal-grid" id="calGrid"></div>
          <div class="cal-footer">
            <button type="button" id="calToday">Bugun</button>
            <button type="button" id="calClear">Temizle</button>
          </div>
        </div>
      </div>
    </div>
    <div class="sheet-footer">
      <div class="btn-row">
        <button class="btn close" id="closeBtn">Kapat</button>
        <button class="btn clear hidden" id="clearDetailBtn">Temizle</button>
        <button class="btn save" id="saveBtn">Kaydet</button>
      </div>
      <div class="status" id="saveStatus"></div>
    </div>
  </div>
</div>

<div class="overlay" id="plakaOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Plaka Yonetimi</h2><div class="sub">Excel'de gecen plakalar otomatik eklenir.</div></div>
    <div class="sheet-body">
      <div class="plaka-list" id="plakaList"></div>
      <div class="plaka-add-row">
        <input type="text" id="newPlakaInput" placeholder="Yeni plaka, orn: 76AV604" />
        <button type="button" id="addPlakaBtn">Ekle</button>
      </div>
    </div>
    <div class="sheet-footer">
      <button class="btn close" id="closePlakaBtn" style="width:100%;">Kapat</button>
      <div class="status" id="plakaStatus"></div>
    </div>
  </div>
</div>

<div class="overlay" id="paymentOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Odeme Bildirimleri</h2><div class="sub" id="paymentOverlaySub">Onay bekleyen odeme raporlari</div></div>
    <div class="sheet-body" id="paymentList"></div>
    <div class="sheet-footer">
      <button class="btn close" id="closePaymentBtn" style="width:100%;">Kapat</button>
      <div class="status" id="paymentStatus"></div>
    </div>
  </div>
</div>

<div class="overlay" id="dueAlertOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Gunu Gelen Odemeler</h2><div class="sub">Odeme tarihi bugun veya daha once gelmis cariler</div></div>
    <div class="sheet-body" id="dueAlertList"></div>
    <div class="sheet-footer">
      <button class="btn close" id="closeDueAlertBtn" style="width:100%;">Kapat</button>
    </div>
  </div>
</div>

<div class="overlay" id="historyOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Gecmis Kayitlar</h2><div class="sub">Son 200 duzenleme</div></div>
    <div class="sheet-body">
      <input class="search" id="historySearch" placeholder="Cari adina gore ara..." style="margin:0 0 8px 0;" />
      <div id="historyList"></div>
    </div>
    <div class="sheet-footer">
      <button class="btn close" id="closeHistoryBtn" style="width:100%;">Kapat</button>
    </div>
  </div>
</div>

<div class="overlay" id="uploadOverlay">
  <div class="sheet">
    <div class="sheet-head" style="text-align:center;">
      <div class="upload-icon" id="uploadIcon">⏳</div>
      <h2 id="uploadTitle">Excel Yukleniyor</h2>
    </div>
    <div class="sheet-body">
      <div class="upload-progress-wrap"><div class="upload-progress-bar" id="uploadProgressBar"></div></div>
      <div class="upload-progress-text" id="uploadProgressText">Basliyor...</div>
      <div class="upload-summary" id="uploadSummary"></div>
    </div>
    <div class="sheet-footer">
      <button class="btn save hidden" id="uploadCloseBtn" style="width:100%;">Tamam</button>
    </div>
  </div>
</div>

<div class="overlay" id="soforOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Sofor Tanimlama</h2><div class="sub">Her plakaya bir sofor/plasiyer ismi verebilirsiniz.</div></div>
    <div class="sheet-body" id="soforList"></div>
    <div class="sheet-footer">
      <button class="btn close" id="closeSoforBtn" style="width:100%;">Kapat</button>
      <div class="status" id="soforStatus"></div>
    </div>
  </div>
</div>

<div class="overlay" id="basariOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Dunun Basarisi</h2><div class="sub">Son Excel yuklemesine gore en cok tahsilat</div></div>
    <div class="sheet-body" id="basariBody">
      <div class="empty">Henuz karsilastirma verisi yok.</div>
    </div>
    <div class="sheet-footer">
      <button class="btn close" id="closeBasariBtn" style="width:100%;">Kapat</button>
    </div>
  </div>
</div>

<div class="overlay" id="tahsilatOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Tahsilat Durumu</h2><div class="sub">Son tahsilat tarihine gore gecikmis cariler</div></div>
    <div class="sheet-body">
      <div class="filter-notice" id="tahsilatFilterNotice"></div>
      <div class="tab-row">
        <button type="button" class="tab-btn" id="tabGunSayisi">Gun Sayisi Gir</button>
        <button type="button" class="tab-btn" id="tab1Ay">1 Aylik</button>
        <button type="button" class="tab-btn" id="tab2Ay">2 Aylik</button>
        <button type="button" class="tab-btn" id="tab3Ay">3 Aylik</button>
        <button type="button" class="tab-btn" id="tab3AyUstu">3 Aydan Fazla</button>
      </div>
      <div class="inline-input-row" id="gunSayisiRow">
        <input type="number" id="gunSayisiInput" placeholder="Gun sayisi, orn: 21" />
        <button type="button" id="gunSayisiGosterBtn">Goster</button>
      </div>
      <div id="tahsilatResults" style="margin-top:10px;"></div>
    </div>
    <div class="sheet-footer">
      <button class="btn close" id="closeTahsilatBtn" style="width:100%;">Kapat</button>
    </div>
  </div>
</div>

<div class="overlay" id="odemeBekleyenOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Odeme Bekleyenler</h2><div class="sub">Odeme tarihi girilmis cariler</div></div>
    <div class="sheet-body">
      <div class="filter-notice" id="odemeFilterNotice"></div>
      <div class="tab-row">
        <button type="button" class="tab-btn" id="tabSortDate">Tarihe Gore</button>
        <button type="button" class="tab-btn" id="tabSortDebt">Bakiyeye Gore</button>
      </div>
      <div id="odemeBekleyenResults" style="margin-top:10px;"></div>
    </div>
    <div class="sheet-footer">
      <button class="btn close" id="closeOdemeBekleyenBtn" style="width:100%;">Kapat</button>
    </div>
  </div>
</div>

<div class="overlay" id="trendOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Tahsilat Trendi</h2><div class="sub">Secili tarih araliginda gunluk net tahsilat (tum plakalar toplami)</div></div>
    <div class="sheet-body">
      <div class="date-range-row">
        <input type="date" id="trendStartDate" />
        <input type="date" id="trendEndDate" />
        <button type="button" id="trendGosterBtn">Goster</button>
      </div>
      <div id="trendChartArea" style="margin-top:14px;"></div>
    </div>
    <div class="sheet-footer">
      <button class="btn close" id="closeTrendBtn" style="width:100%;">Kapat</button>
    </div>
  </div>
</div>

<div class="overlay" id="userMgmtOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2>Kullanici Tanimlama</h2><div class="sub">Yeni yonetici hesaplari olusturun. Sifreler burada gorunur.</div></div>
    <div class="sheet-body">
      <div id="userMgmtList"></div>
      <div class="plaka-add-row" style="flex-direction:column; gap:6px; align-items:stretch;">
        <input type="text" id="newUserNameInput" placeholder="Isim" />
        <input type="text" id="newUserPassInput" placeholder="Sifre (1-16 karakter)" maxlength="16" />
        <button type="button" id="addUserBtn">Ekle</button>
      </div>
    </div>
    <div class="sheet-footer">
      <button class="btn close" id="closeUserMgmtBtn" style="width:100%;">Kapat</button>
      <div class="status" id="userMgmtStatus"></div>
    </div>
  </div>
</div>

<div class="overlay" id="customModalOverlay">
  <div class="sheet">
    <div class="sheet-head"><h2 id="customModalTitle">Bilgi</h2></div>
    <div class="sheet-body">
      <div id="customModalMessage"></div>
      <input type="text" id="customModalInput" class="hidden" />
    </div>
    <div class="sheet-footer">
      <div class="btn-row">
        <button class="btn close hidden" id="customModalCancelBtn">Iptal</button>
        <button class="btn save" id="customModalOkBtn">Tamam</button>
      </div>
    </div>
  </div>
</div>

</div><!-- #appRoot -->

<script type="module" src="app.js"></script>
</body>
</html>
