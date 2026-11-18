# ✅ Yapılacaklar

Telefon için tasarlanmış kişisel yapılacaklar listesi. Tek `index.html` + Firebase (Auth + Firestore).

## Özellikler
- **Görünümler:** Bugün (gecikmişler dahil), Yaklaşan, Önemli, Tümü, Tarihsiz, Tamamlanan
- **Özel listeler:** emoji + renk (İş, Ev, Alışveriş…)
- **Görev ayrıntıları:** not, tarih, saat, 3 seviye öncelik, etiketler, alt görevler
- **Tekrarlayan görevler:** her gün / hafta içi / her hafta / her ay / her yıl
- **Hızlı ekleme:** `Fatura öde yarın 14:00 !3 #ev @İş`
  - `bugün`, `yarın`, `öbür gün`, `pzt…paz`, `25.12` → tarih
  - `14:00` → saat · `!1` `!2` `!3` → öncelik · `#etiket` · `@ListeAdı`
- Arama (`#etiket` ile etiket araması), 5 farklı sıralama
- Geri al (tamamlama / silme), JSON yedek indirme, açık/koyu tema
- **Çevrimdışı çalışır** — internet gelince senkronlanır
- Ana ekrana eklenebilir (PWA)

## Veri yapısı (Firestore)
```
todo/ercan/lists/{listId}  → name, icon, color, order
todo/ercan/tasks/{taskId}  → title, note, due, time, priority, listId,
                             repeat, tags[], subtasks[{t,d}], done, doneAt
```

## Kurulum
Giriş ekranı yoktur; sayfa açılınca otomatik anonim oturum açılır.
1. Firebase Console → **Authentication** → Sign-in method → **Anonymous**'u aç.
2. **Firestore Database** → **Rules** sekmesine `firestore.rules` içeriğini yapıştırıp **Publish**.
3. Authentication → Settings → **Authorized domains**'e `ledsaha.com` ve `www.ledsaha.com` ekle.

Yayın adresi: https://www.ledsaha.com/todo/
