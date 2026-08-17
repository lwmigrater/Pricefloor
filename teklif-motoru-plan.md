# Teklif Motoru — Shopify App Planı

> Kural tabanlı otomatik B2B fiyat teklifi motoru.
> Mevcut RFQ app'leri talebi **toplayıp insana yollar**. Bu app talebi **karara bağlar**.
> Uzun vadeli opsiyon: aynı motor, protokole fiyat esnekliği alanı geldiğinde agent'lara açılır.

---

## 0. Konumlandırma

**Tek cümle:** Toptan fiyat talebini, marj tabanını ihlal etmeden, saniyeler içinde cevaplayan politika motoru.

**Birincil satış argümanı:** Rakip wholesale app'leri "liste fiyatı − %20" mantığıyla çalışır. Tedarikçi maliyeti arttığında merchant farkında olmadan zararına teklif verir. Bu app her teklifi `unit_cost` üzerinden doğrular; marj tabanının altına inen bir fiyat hiçbir koşulda çıkmaz.

**İkincil argüman:** Stok yaşına göre esneme payı → otomatik ölü stok tahliyesi.

**Kaçınılacak konumlandırma:** "Teklif formu", "RFQ", "wholesale çözümü". Bu kelimeler seni dolu bir kategoriye sokar. Kullanılacak dil: *fiyat politikası*, *marj koruması*, *otomatik onay oranı*.

**Kuzey yıldızı metriği:** Taleplerin yüzde kaçı insana dokunmadan kapandı. Panonun en üstündeki sayı bu olmalı.

---

## 1. Kod yazmadan önce doğrulanacaklar

Bunlar bitmeden repo açma. Toplam süre: yarım gün.

| # | Doğrulama | Nasıl | Sonuç yanlışsa |
|---|---|---|---|
| 1 | Mevcut RFQ app'lerinden 2-3 tanesi otomatik fiyatlıyor mu, yoksa hepsi insana mı yolluyor? | Development store'a kur, gerçek talep gönder | Biri otomatik fiyatlıyorsa konumlandırma değişir |
| 2 | Basic planda taslak siparişte satır bazlı özel fiyat + fatura akışı çalışıyor mu? | Test mağazası, elle taslak sipariş | Çalışmıyorsa hedef plan Grow+ olur |
| 3 | `unitCost` API'den varyant bazında güvenilir geliyor mu? | GraphQL sorgusu (§5.2) | Boşsa onboarding'e toplu maliyet içe aktarma şart |
| 4 | Mevcut B2B app'leriyle çakışma var mı (aynı anda kurulu olabilir mi)? | BSS/SparkLayer kurulu mağazada test | Çakışma varsa "yanında çalışır" mesajı gerekir |
| 5 | Taslak sipariş satır fiyatı için güncel API alan adı ne? | Hedef API sürümünün şemasını kontrol et | — |

**API sürümü:** `2026-07` (boilerplate `shopify.app.template.toml` ile hizalı, 2026-08-03'te sabitlendi).

**Doğrulanmış alan adları (2026-07, `validate_graphql_codeblocks` ile teyit):**
- `DraftOrderLineItemInput.priceOverride: MoneyInput` — variantId ile birlikte satır bazlı fiyat override için kullanılacak alan (§5.3). ✅
- `productVariants.inventoryItem.unitCost { amount currencyCode }` — maliyet çekimi (§5.2). ✅
- `DraftOrder.totalPrice` **deprecated** → `DraftOrder.totalPriceSet { shopMoney { amount currencyCode } }` kullan.
- `originalUnitPriceWithCurrency` alanı variantId varken yok sayılır — kullanma.
- `unitCost` için `read_inventory` **veya** `read_products` scope'undan biri yeterli. Planda `read_inventory` tutulur.
- **Not:** 2026-07 doğrulaması `write_quick_sale` / `read_quick_sale` scope'unu draft order için "gerekli olabilir" olarak işaretledi. POS Pro'ya bağlı olabilir; MVP web-only olduğu için eklenmez, ilk canlı test sırasında Shopify hata dönerse eklenir.

---

## 2. Kapsam

### MVP'de var
- Marj tabanı kuralı (`unit_cost` üzerinden)
- Hacim merdiveni
- Müşteri kademesi / şirket bazlı tavan
- Değerlendirme zinciri ve karar çıktısı
- Otomatik onay → taslak sipariş + süreli teklif
- Karşı teklif üretimi
- İnsana yükseltme kuyruğu (24 saat SLA + merchant admin e-posta bildirimi)
- Denetim kaydı (kesinlikle kesme)
- Kural kurulum arayüzü

### MVP'de yok (faz 2)
- Stok yaşı esnekliği
- Fiyat dışı takas (peşin ödeme / uzun teslim → ek pay)
- ERP / EDI
- Çoklu para birimi
- Agent ucu (sadece mimari yeri boş bırakılır)
- Satış temsilcisi rolleri
- Teklif → sipariş dönüşüm analitiği

---

## 3. Mimari

```
Alıcı (form / e-posta / API)
        │
        ▼
  Talep alımı  ──────────────► Supabase (talep kaydı)
        │
        ▼
  Kural motoru  ◄────────────  Kural seti (Supabase)
        │                      Maliyet + stok (Shopify, cache)
        ▼
  Karar: onay | karşı teklif | yükselt
        │
        ├─ onay/karşı ──► Shopify draftOrderCreate ──► fatura linki
        └─ yükselt ─────► admin kuyruğu (Polaris)
        │
        ▼
  Denetim kaydı (Supabase, değiştirilemez)
```

**Katmanlar:**
- **Shopify app** (mevcut boilerplate): admin arayüzü, OAuth, webhook alımı, GraphQL çağrıları
- **Supabase**: kurallar, talepler, kararlar, denetim kaydı, maliyet cache'i
- **Kural motoru**: saf fonksiyon. Girdi ve çıktı JSON. Shopify'dan ve DB'den bağımsız — birim testi bunun üzerine kurulur

**Kritik tasarım kararı:** Kural motoru saf tutulacak. `evaluate(request, ruleSet, costSnapshot) → decision`. Ne DB'ye ne Shopify'a dokunur. Bunun iki sebebi var: test edilebilirlik, ve ileride agent ucuna aynı fonksiyonu bağlayabilmek.

---

## 4. Shopify izinleri ve webhook'lar

### Scopes
```
read_products
read_inventory          # unitCost için — zorunlu
write_draft_orders
read_draft_orders
read_customers
read_companies          # B2B şirket/lokasyon
write_companies         # faz 2'de gerekebilir
read_orders             # teklif → sipariş eşleşmesi
```

### Webhook'lar
```
orders/create           # teklif kapanışı
draft_orders/update     # dışarıdan değişiklik tespiti
products/update         # maliyet cache invalidation
inventory_items/update  # maliyet cache invalidation
app/uninstalled
# + zorunlu GDPR webhook'ları (customers/data_request, customers/redact, shop/redact)
```

---

## 5. Shopify entegrasyon detayları

### 5.1 Katalog tuzağı

Plus dışı planlarda **en fazla 3 aktif fiyat kataloğu** var. Müşteri başına katalog üretme mimarisi üçüncü müşteride duvara toslar.

**Karar:** Fiyat kuralları Supabase'de yaşar. Shopify'a sadece **sonuç** yazılır (taslak sipariş satır fiyatı olarak). Katalog/price list objelerine hiç dokunulmaz.

Bu aynı zamanda mevcut B2B app'leriyle çakışmayı da önler.

### 5.2 Maliyet çekimi

```graphql
query VariantCosts($cursor: String) {
  productVariants(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      sku
      price
      inventoryItem {
        id
        unitCost { amount currencyCode }
      }
      inventoryQuantity
    }
  }
}
```

- Kurulumda tam senkron, sonra webhook ile artımlı
- `unitCost` null olan varyantlar ayrı listelenir → onboarding'de merchant'a gösterilir
- **Maliyeti olmayan üründe otomatik onay verilmez.** Kural: maliyet yoksa her zaman yükselt. Bu güvenlik kilidi tartışmasız.

**Cache tutarlılığı (karar anında):**
- `cost_cache` satırında `fetched_at` tutulur, TTL varsayılan **5 dakika**.
- Karar öncesi motor TTL'i kontrol eder. Taze → cache. Bayat → o an tek varyant için canlı GraphQL çekimi, cache güncellenir, sonra karar.
- Webhook (`products/update`, `inventory_items/update`) cache'i invalidate eder ama TTL kontrolü webhook gecikmesine/kaybına karşı ikinci savunma hattıdır.
- Kararla birlikte kullanılan `unitCost` değeri ve `fetched_at` denetim kaydına da yazılır (§6.4).

### 5.3 Taslak sipariş oluşturma

```graphql
mutation CreateQuote($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      name
      invoiceUrl
      totalPriceSet { shopMoney { amount currencyCode } }
    }
    userErrors { field message }
  }
}
```

Satır fiyatı override alanı: `DraftOrderLineItemInput.priceOverride: MoneyInput` (2026-07, §1'de doğrulanmış).

**Teklif süresi:** Shopify'da native "teklif geçerlilik süresi" yok. Kendi tarafında `expires_at` tut. Süre dolunca:
- Draft order'a `expired` tag'i eklenir (Shopify admin'de iz kalır).
- Motorun invoice bloklama listesine alınır — alıcı eski link'i tıklarsa app proxy tarafında "teklif süresi doldu" sayfası döner.
- **`draftOrderDelete` kullanılmaz.** Silmek denetim izini bozar ve merchant geçmişi göremez. Geçmiş her zaman erişilebilir kalmalı.

Süreli teklif, pazarlığın en güçlü aracı — atlamak ürünü zayıflatır.

### 5.4 Talep girişi

MVP'de tek kanal: **Shopify Forms** veya app proxy üzerinden basit bir form. Kendi form altyapını yazma.

E-posta ile gelen talepleri parse etme (§ faz 2) en büyük değer kaynağı ama en büyük hata kaynağı. MVP'de yok.

---

## 6. Kural motoru spesifikasyonu

### 6.1 Girdi

```json
{
  "requestId": "uuid",
  "company": { "id": "gid://...", "tier": "gold" },
  "lines": [
    { "variantId": "gid://...", "quantity": 500, "requestedUnitPrice": 12.50 }
  ],
  "terms": { "payment": "net30", "leadTimeDays": 14 },
  "currency": "USD"
}
```

`requestedUnitPrice` opsiyonel. Yoksa motor "en iyi fiyatın nedir" sorusuna cevap üretir.

### 6.2 Kural tipleri (MVP: 1-3, faz 2: 4-7)

| # | Kural | Tanım | Etki |
|---|---|---|---|
| 1 | **Marj tabanı** | `unit_cost` üzerine minimum % veya mutlak tutar | Sert kilit — asla aşılmaz |
| 2 | **Hacim merdiveni** | Adet kırılımı → indirim oranı | Pay ekler |
| 3 | **Müşteri kademesi** | Segment/şirket bazlı maksimum indirim | Tavan koyar |
| 4 | **Stok yaşı** | X günden eski stokta ek pay | Pay ekler |
| 5 | **Ürün istisnası** | MAP, yeni sezon, marka korumalı → pazarlığa kapalı | Sert kilit |
| 6 | **Şart takası** | Peşin ödeme / uzun teslim / karma palet → ek pay | Pay ekler |
| 7 | **Mutlak tavan** | Kurallar birikse de toplam indirim şunu geçemez | Sert kilit |

### 6.3 Değerlendirme sırası (deterministik, değiştirilemez)

```
1. Sert kilitleri topla       → izin verilen minimum fiyat (floor)
2. Payları topla              → önerilebilecek en iyi fiyat (best)
3. Tavanları uygula           → best = min(best_by_discount_cap, best)
4. floor > best ise           → kural seti tutarsız, yükselt + admin'e uyar
5. Karar (satır bazlı):
     requestedPrice yok        → "best" ile teklif ver
     requestedPrice >= best    → otomatik onay
     floor <= requested < best → otomatik onay (talep edilen fiyat)
     requestedPrice < floor    → karşı teklif = floor
     maliyet yok / istisna     → yükselt
6. Teklif bazlı toparlama:
     Herhangi bir satır escalate ise → tüm teklif escalate
     (Kısmi teklif yok. Alıcı tek bir karar/fatura alır; merchant tek noktadan onaylar.)
```

**4. adım önemli:** merchant çelişkili kural yazacak. Motor bunu sessizce çözmeye çalışmamalı, insana taşımalı.

**6. adım önemli:** Satır bazlı karma karar (bir kısmı otomatik, bir kısmı escalate) alıcıya iki ayrı iletişim demek ve pazarlığı zayıflatır. MVP'de her zaman tek karar.

### 6.4 Çıktı

```json
{
  "decision": "auto_approve | counter_offer | escalate",
  "lines": [
    {
      "variantId": "gid://...",
      "quantity": 500,
      "unitPrice": 12.80,
      "unitCost": 9.00,
      "marginPct": 29.7,
      "appliedRules": ["margin_floor:v2", "volume_ladder:500+", "tier_cap:gold"]
    }
  ],
  "totalPrice": 6400.00,
  "expiresAt": "2026-08-16T00:00:00Z",
  "decisionReason": "requested_matches_best"
}
```

**`decisionReason` her karar tipi için doldurulur** (tek alan, karar tipine göre farklı enum değerleri):

| decision | Olası decisionReason değerleri |
|---|---|
| `auto_approve` | `requested_matches_best`, `requested_between_floor_and_best`, `no_request_best_offered` |
| `counter_offer` | `below_floor`, `discount_cap_exceeded` |
| `escalate` | `no_cost_data`, `product_excluded`, `rules_inconsistent` (floor > best), `line_escalated` (aynı teklifte başka satır escalate ettirdi), `manual_review_required` |

`appliedRules` ve `decisionReason` birlikte denetim kaydının ve merchant güveninin temeli. Her karar açıklanabilir olmalı — "neden bu fiyat" sorusuna tek tıkla cevap veremiyorsan merchant motoru kapatır.

---

## 7. Veri modeli (yüzeysel — detay sonra)

Supabase mevcut ve çok app'li. Şema/prefix stratejisini sen vereceksin. Mantıksal varlıklar:

- **rule_sets** — mağaza başına aktif kural seti, sürümlü (kural değişince eski kararlar hâlâ açıklanabilmeli)
- **rules** — tip, parametreler, öncelik, kapsam (ürün/koleksiyon/segment)
- **quote_requests** — gelen talep, ham girdi, kaynak kanal
- **quote_decisions** — motor çıktısı, uygulanan kurallar, taslak sipariş referansı
- **audit_log** — değiştirilemez; kim, ne zaman, hangi kuralla, hangi fiyat
- **cost_cache** — varyant → unit_cost, stok, son senkron zamanı
- **escalations** — kuyruk, atanan kişi, sonuç

**Değişmez kurallar:**
- Her tabloda `shop_domain` (çok kiracılı izolasyon)
- `rule_sets` sürümlü, `quote_decisions` sürüme referans verir
- `audit_log` sadece append — update/delete yok

---

## 8. Arayüz ekranları (Polaris)

1. **Pano** — otomatik onay oranı, bekleyen yükseltmeler, son teklifler, ortalama marj
2. **Kurallar** — kural seti düzenleme, sürüm geçmişi, çelişki uyarıları
3. **Simülatör** — "500 adet X, gold müşteri" gir, motorun ne diyeceğini gör. *Bu ekran satışın kendisi. Demo bunun üzerinden yapılır, MVP'den çıkarma.*
4. **Yükseltme kuyruğu** — insan kararı gereken talepler, tek tıkla teklif gönderme
5. **Teklif geçmişi** — filtrelenebilir, her satırda "neden bu fiyat" açılır
6. **Kurulum** — maliyet senkronu, eksik maliyet listesi, ilk kural seti sihirbazı

---

## 9. Dört haftalık plan

### Hafta 1 — Temel
- [x] Boilerplate'ten proje kurulumu, scope'lar, webhook kayıtları (`shopify.app.template.toml`, `.env.example`)
- [x] Supabase bağlantısı, mantıksal varlıkların tabloya dökülmesi (`005_pricefloor.sql` — pf_rule_sets, pf_rules, pf_quote_requests, pf_quote_decisions, pf_audit_log append-only, pf_cost_cache, pf_escalations + plan seed overwrite starter/growth/scale)
- [x] Maliyet senkronu (tam + artımlı), cost_cache (`adapters/shopify/cost-sync.ts` + `services/cost-cache.service.ts` + webhook route'ları products/inventory)
- [x] Kural motoru iskeleti: sadece marj tabanı, saf fonksiyon (`engine/types.ts` + `engine/evaluate.ts`; birim testleri Hafta 1 sonuna ertelendi — 2026-08-03 kararı)
- [x] Uçtan uca ilk akış: sabit talep → karar → konsol çıktısı (`scripts/pricefloor-smoke.ts`, `npm run pricefloor:smoke`)

### Hafta 2 — Motor
- [ ] Hacim merdiveni, müşteri kademesi
- [ ] Değerlendirme zinciri, çelişki tespiti
- [ ] Karşı teklif mantığı
- [ ] Karar → `draftOrderCreate`, fatura linki, `expires_at`
- [ ] Denetim kaydı yazımı

### Hafta 3 — Akış
- [ ] Talep girişi (Forms / app proxy)
- [ ] Yükseltme kuyruğu ekranı + escalation → merchant admin e-postası (anlık) + 24 saat SLA hatırlatma cron'u
- [ ] Teklif geçmişi + "neden bu fiyat"
- [ ] Teklif süresi dolduğunda kapatma işi (cron): `expired` tag + invoice bloklama
- [ ] Sipariş webhook'u ile teklif kapanışı eşleştirme (draftOrderCompleteId + email + expires_at fallback)

### Hafta 4 — Ürünleşme
- [ ] Kural kurulum arayüzü
- [ ] Simülatör ekranı
- [ ] Onboarding: maliyet kontrolü, eksik maliyet uyarısı, ilk kural seti
- [ ] Shopify Billing API, planlar
- [ ] Pano
- [ ] App listing: başlık, görseller, demo videosu

**Hafta 4'ün yarısı listing'e gidiyor.** Bu bir gecikme değil, önceki app'lerinin takıldığı yer burası.

---

## 10. Faturalandırma

- Shopify Billing API, `appSubscriptionCreate`
- 14 gün deneme
- Planlar hacme değil **kapsama** göre: aktif şirket sayısı ve kural sayısı
  - Starter $49 — 25 şirket, 3 kural tipi
  - Growth $99 — 100 şirket, tüm kural tipleri, simülatör
  - Scale $199 — sınırsız, API erişimi, öncelikli destek

Not: 10/50 eşikleri denendi ve reddedildi. Tek bir bayi/lokasyon yapısı bile 5-10 şirket kaydı üretebiliyor; Starter'ın "kurulmadan pahalanıyor" hissi vermemesi için taban 25.
- Fiyatı düşük tutma. B2B alıcısı analitik alıcısından daha az fiyat hassas ve bu app doğrudan marj koruyor.

---

## 11. Riskler ve kilitler

| Risk | Kilit |
|---|---|
| Maliyet verisi eksik/yanlış → zararına teklif | Maliyet yoksa otomatik onay yok, her zaman yükselt |
| Merchant çelişkili kural yazar | Çelişki tespiti + kaydetmeden önce simülasyon zorunlu |
| Kural değişti, eski teklif açıklanamıyor | Kural setleri sürümlü, kararlar sürüme bağlı |
| Alıcı sistematik olarak tabanı yokluyor | Şirket başına talep hız limiti + tekrar eden talep uyarısı |
| Kişiselleştirilmiş fiyat mevzuatı (AB tarafında açıklama yükümlülüğü olabilir) | B2B'de risk düşük ama teklifte "size özel fiyat" ifadesi ve denetim kaydı tut. Hukuki görüş gerekiyorsa avukata sor. |
| Mevcut B2B app'iyle çakışma | Katalog objelerine hiç dokunma (§5.1) |
| Shopify API rate limit / cost point tükenmesi (özellikle initial maliyet senkronu) | Initial sync `bulkOperationRunQuery` ile arka planda; artan güncellemeler webhook + karar anında tekil canlı çekim. Kararlar 100'lük paged query yapmaz. |
| Alıcı invoice link ile ödediğinde draft order → order native bağı kopabilir (teklif kapanışı yanlış eşleşir) | Üç aşamalı fallback eşleşme: (1) `Order.draftOrderId` / `draftOrderCompleteId`, (2) email + total match + 24 saat pencere, (3) elle eşleştirme UI. Eşleşmemiş siparişler admin'de uyarı olarak listelenir. |

---

## 12. Agent köprüsü (bugün kod yazma)

Motor zaten `evaluate(request, ruleSet, costSnapshot) → decision` saf fonksiyonu. İleride yapılacak tek iş:

```
POST /agent/quote   → aynı fonksiyon, farklı kimlik doğrulama
```

Protokole fiyat esnekliği alanı gelene kadar bu uç **yazılmayacak**. Bugün yapılacak tek şey motoru saf tutmak. Bu, sıfır maliyetle tutulan bir opsiyon.

Tetikleyici: UCP/ACP spec'inde fiyat müzakeresi alanı yayınlandığında. `ucp.dev` ve ACP GitHub deposunu üç ayda bir kontrol et.

---

## 13. İlk 10 müşteri

App Store SEO'ya bel bağlama. Kanallar:

1. **Fuar sonrası toptancılar** — sipariş yığını en acılı anda
2. **Türkiye'deki toptan Shopify mağazaları** — tekstil, gıda, kozmetik. Telefonla ulaşabildiğin tek kitle, coğrafi engel yok
3. **Shopify ajansları** — B2B kurulumu yapan 5-10 ajans, referans anlaşması
4. **Mevcut B2B app'lerinin yorumları** — "teklif verme yavaş" diyen merchant'lar doğrudan hedef

**Demo senaryosu:** Simülatör ekranını aç, merchant'ın kendi ürününü ve gerçek bir müşterisini gir, motorun verdiği fiyatı elle verdiği fiyatla karşılaştır. Satış bu tek ekranda kapanır.

---

## 14. Açık sorular

- [ ] E-posta ile gelen talebi parse etmek faz 2'de mi, hiç mi? (En büyük değer, en büyük hata riski)
- [ ] Çoklu para birimi ne zaman gerekiyor — ilk müşteri profiline bağlı
- [x] ~~Yükseltme kuyruğunda SLA/bildirim gerekli mi~~ → 24 saat SLA + merchant admin e-postası MVP'de. Slack faz 2.
- [ ] Teklif PDF çıktısı isteniyor mu (B2B'de sık istenir, MVP'de yok)

---

## 15. Launch playbook (Hafta 5 — kod tarafı bittikten sonra)

Sıra: **deploy config sanity** → **`shopify app deploy`** → **onboarding** → **seed** → **cost sync tetikle** → **motor smoke** → **proxy quote E2E** → **cron doğrulama**.

### 15.0 Deploy öncesi son kontrol listesi

- [ ] `shopify.app.toml` içindeki `[access_scopes] scopes` **dolu** olmalı. Template'e göre: `read_products,read_inventory,read_customers,read_companies,write_companies,read_draft_orders,write_draft_orders,read_orders`. Aktif toml'da boş görünüyorsa deploy yarım geçer.
- [ ] `shopify.app.toml` içinde `[[webhooks.subscriptions]]` blokları eklenmiş olmalı: `app/uninstalled`, `app/scopes_update`, `orders/create`, `draft_orders/update`, `products/update`, `inventory_items/update` + compliance topic'leri (`customers/data_request`, `customers/redact`, `shop/redact`). Yoksa `shopify.app.template.toml`'dan kopyala.
- [ ] `shopify.app.toml` `api_version` = **2026-07** ([[reference-plan-doc]] §1). Aktif dosya farklı sürüm gösteriyorsa güncelle (2026-10 gibi bir değer yanlış set edilmişse).
- [ ] `[app_proxy]` bloğu `subpath = "pricefloor"`, `prefix = "apps"`. Proxy URL app URL'ine bağlı olacak (CLI dev'de otomatik yazar).
- [ ] `.env` (veya Vercel env): `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `MAILGUN_API_KEY` (email için) tanımlı.
- [ ] Supabase migration'ları uygulandı: `001_app_entries.sql`, `003_plans_and_limits.sql`, `004_fix_subscriptions_plan_id.sql`, `005_pricefloor.sql`, `006_pricefloor_sla_idempotency.sql`. `supabase db push` veya dashboard SQL editor'den sırayla çalıştır.
- [ ] `npm run typecheck` uygulama kodu için temiz (Deno edge fn hataları normal — o Supabase runtime'da çalışıyor).

### 15.1 Deploy

```bash
shopify app deploy
```

Sonuç: proxy `/apps/pricefloor/quote` aktif olur, webhook subscription'ları Shopify'da register olur.

### 15.2 Onboarding & seed

Dev store'a app'i install et. Onboarding'i tamamla — `app.onboarding.tsx` şunları paralel yapar:

- `syncMerchantContact` → shop.email'i `company_meta.merchant_email`'e yazar
- `seedDefaultRuleSet` → margin_floor 20% + volume 100/500/1000 + tier_cap gold %10 (yalnız active set yoksa)
- `syncPricefloorCosts` → tüm variant'ların unit_cost'unu `pf_cost_cache`'e çeker

Alternatif (onboarding sonrası re-seed): 

```bash
SHOPIFY_SHOP=vayes-test.myshopify.com npm run pricefloor:seed-rules
```

### 15.3 Motor smoke (Shopify'a dokunmadan)

```bash
npm run pricefloor:smoke
```

12 senaryonun tümünde beklenen `decision`/`decisionReason`/`totalPrice` bekleniyor. Her senaryonun adı zaten beklenen davranışı söylüyor.

### 15.4 Live draftOrderCreate testi (Shopify'a dokunur, invoice email yollamaz)

```bash
PF_LIVE=true \
SHOPIFY_SHOP=vayes-test.myshopify.com \
SHOPIFY_ADMIN_TOKEN=shpat_xxx \
PF_TEST_VARIANT_ID=gid://shopify/ProductVariant/XXXXX \
npm run pricefloor:smoke
```

Çıktıda `invoiceUrl` görmelisin. Incognito'da aç → checkout $12.50'de olmalı.

### 15.5 Proxy quote uçtan uca (buyer akışı)

App proxy signature'ı Shopify tarafından imzalanır. Test için Shopify CLI dev tünelini kullan veya storefront JS'ten çağır:

```bash
curl -X POST "https://<dev-shop>/apps/pricefloor/quote" \
  -H "Content-Type: application/json" \
  -d '{
    "shopifyCustomerId": "gid://shopify/Customer/YYYYY",
    "customerEmail": "buyer@example.com",
    "companyTier": "gold",
    "lines": [
      { "variantId": "gid://shopify/ProductVariant/XXXXX", "quantity": 500, "requestedUnitPrice": 12.5 }
    ]
  }'
```

Yalnız Shopify signature ile geldiği zaman `authenticate.public.appProxy` geçer — bu yüzden manuel curl 401 verir. Doğru yol: dev store storefront'una minimal bir fetch script koy, `shop.myshopify.com/apps/pricefloor/quote`'a POST at.

Beklenen response:

```json
{
  "decision": "auto_approve",
  "reason": "requested_matches_best",
  "totalPrice": 6250,
  "currency": "USD",
  "lines": [...],
  "invoiceUrl": "https://<shop>/admin/draft_orders/xxx/invoice/...",
  "expiresAt": "2026-08-18T..."
}
```

`customerEmail`'i geçtiysen — sonraki `orders/create` webhook'u fallback matcher'ı tetikleyebilir.

### 15.6 Cron doğrulama

- Vercel Deploy → Functions → Crons: iki job listede `pricefloor-sla-reminders` (0 * * * *) ve `pricefloor-expired-quotes` (15 * * * *)
- Manuel tetikle:

```bash
curl "https://<app-url>/api/cron/pricefloor-sla-reminders" \
  -H "Authorization: Bearer $CRON_SECRET"
# → { "ok": true, "reminded": 0 } (henüz eski escalation yok)
```

### 15.7 Kabul kriteri

- [ ] Onboarding sonrası dashboard `active rule set` gösteriyor, `cached variants` sayısı > 0
- [ ] `/app/pricefloor/simulator` bir requested_price ile auto_approve döner
- [ ] Proxy quote → invoice URL → incognito'da custom fiyatta checkout görünür
- [ ] Simulate escalate (no_cost_data variant) → `/app/pricefloor/escalations`'da satır belirir + merchant e-posta gelir
- [ ] Bir invoice'ı ödediğinde `orders/create` webhook → `pf_audit_log`'da `quote_closed_won` satırı + Shopify draft order'da `pricefloor:closed_won` tag

Bu checklist geçtiğinde app listing'e hazır.

---

## 16. §1.4 rakip B2B çakışma testi

Amaç: Pricefloor'un mevcut B2B app'leriyle yan yana kurulunca **teknik olarak bozulup bozulmadığını** ve **konumlandırma dilinin ne olması gerektiğini** belirlemek. Sonuç iki koldan birine gider:

- **Yan yana çalışır** → Listing metni: "BSS/SparkLayer ile birlikte çalışır — onlar müşteri portalı, biz fiyat kararı motoru."
- **Çakışır** → Listing metni: "Standalone B2B çözümü — kendi katalog fiyat mantığını yönetir."

### 16.1 Hazırlık

- Ayrı bir dev store (Basic plan, mevcut olan başka bir app'in bulunmadığı temiz store).
- Rakip app'lerden **birini** kur, sonra Pricefloor'u kur, birlikte çalışıyor mu görülür — sonra o rakibi uninstall + ikinciyi kur. Aynı store'da ikisini birden çalıştırma (bulaşma yaratır).
- Rakipler:
  - **BSS Commerce B2B / Wholesale Solution** — çünkü en yaygın Türk merchant tercihidir (marketplace search: "B2B wholesale")
  - **SparkLayer B2B** — çünkü modern B2B kategorisinde referans app

### 16.2 Ne ölçülür (her rakip için ayrı ayrı çalıştır)

| # | Kontrol | Beklenen (çakışma yok) | Sonuç |
|---|---------|-----------------------|-------|
| A | Rakip app kuruluyken Pricefloor `shopify app deploy` işi tamam mı | ✓ | |
| B | Rakip app'in kural/fiyat ekranı Pricefloor Rules ekranını gizliyor mu (nav çakışması) | Yok | |
| C | Rakip kendi wholesale price'ını **variant.price** üzerinden set ediyor mu | Set ediyor / etmiyor | |
| D | Rakip **draft order** oluşturuyor mu (aynı `draftOrderCreate` mutation'ı kullanıyor mu) | Kullanıyor / kullanmıyor | |
| E | Rakip **orders/create** webhook'unu subscribe ediyor mu | Ediyor / etmiyor | |
| F | Rakip **companies API**'yi mi kullanıyor yoksa customer metafield'ı ile mi B2B ayrımı yapıyor | Companies / metafield | |
| G | Pricefloor proxy `/apps/pricefloor/quote` çağrısı hâlâ 200 dönüyor mu | ✓ | |
| H | Pricefloor draft order oluştu — rakip app o draft'a müdahale etti mi (tag ekledi, iptal etti, priceOverride'ı overwrite etti) | Etmedi | |
| I | Bir buyer rakibin akışıyla teklif ister — Pricefloor bu talebi görüyor mu (proxy hitten gelmediği için) | Görmemesi normal — iki app paralel evrende | |
| J | Rakibin admin nav'ı Pricefloor'un module registry navItems'ını gizliyor mu | Yok | |

### 16.3 Sonuç kategorileri

- **✅ Uyumlu** — A/B/G/H/J geçti. C/D/E rakip tarafında farklı yollar → çakışma yok. Listing metni "yanında çalışır" tonu.
- **⚠️ Kısmi çakışma** — H başarısız (rakip Pricefloor draft'ına müdahale ediyor) VEYA E'de rakip orders/create'i **exclusive** subscribe ediyor (Shopify webhook'ları shared, exclusive değil — ama app tarafında race olabilir). Listing metni: "Standalone kullan, aynı store'da başka B2B app'i varsa test et."
- **❌ Çakışma** — A veya G başarısız. Deploy geçmiyor veya proxy 5xx. Bu senaryoda konumlandırma "standalone only" olur.

### 16.4 Doküman şablonu (test bittikten sonra doldurulacak)

```
Rakip: BSS Commerce B2B
Sürüm test edildi: <version>
Test tarihi: <date>
Sonuç: [Uyumlu / Kısmi / Çakışma]
Kritik gözlemler:
  - <gözlem>
Listing tonu: [Yanında çalışır / Kısmi uyarı / Standalone]
```

Aynı şablon SparkLayer için tekrarlanır. İki sonuç en kötü hangisi ise listing metni ona göre yazılır.

### 16.5 Kabul

Bu bölüm §1.4'ün kapanış maddesi. Sonuç geldiğinde [[project-open-validations]] güncellenir ve listing kopyası buradaki tona göre yazılır.
