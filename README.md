# cagritemel.com — Personal Academic Website

Cagri Temel'in kişisel akademik web sitesi. Statik HTML/CSS (build adımı yok), GitHub Pages üzerinde yayınlanır.

## Yapı

```
index.html          → Ana sayfa (hero + about + araştırma alanları)
research.html       → Araştırma & projeler
publications.html   → Yayınlar
patents.html        → Patentler
speaking.html       → Konuşmalar, hakemlik, medya
contact.html        → İletişim
assets/css/style.css→ Tüm tasarım
assets/img/         → Fotoğraflar (profile.jpg buraya)
CNAME               → Custom domain (cagritemel.com)
.nojekyll           → GitHub Pages'in Jekyll işlemesini kapatır
```

## Yerelde önizleme

Klasörde terminal açıp:

```bash
python3 -m http.server 8000
```

Sonra tarayıcıda: http://localhost:8000

## GitHub Pages'e yayınlama

1. GitHub'da `cgrtml.github.io` adında **public** repo oluştur.
2. Bu klasörü push et:
   ```bash
   git init
   git add -A
   git commit -m "Personal academic website"
   git branch -M main
   git remote add origin https://github.com/cgrtml/cgrtml.github.io.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `root`.
4. Birkaç dakika sonra site `https://cgrtml.github.io` adresinde yayında olur.

## Custom domain (cagritemel.com) bağlama

`CNAME` dosyası repoda hazır. Domain sağlayıcının (Wix/registrar) DNS panelinde:

**A kayıtları** (apex / `cagritemel.com` için) — GitHub Pages IP'leri:
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

**CNAME kaydı** (`www` için):
```
www  →  cgrtml.github.io
```

DNS yayılması birkaç saat sürebilir. Sonra GitHub → Settings → Pages'te
**Enforce HTTPS** kutusunu işaretle.

## Yapılacaklar (içerik)

- [ ] `assets/img/profile.jpg` → gerçek profil fotoğrafı
- [ ] LinkedIn / Google Scholar linklerini gerçek adreslerle değiştir
- [ ] Yayınları gerçek başlık + DOI/arXiv ile güncelle
- [ ] Patent başvuru numarası ve durumunu gir
- [ ] Proje tarihlerini ve sonuç/etki cümlelerini netleştir
