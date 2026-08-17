# Polaris Component Templates

Bu klasör, PolarisComponents.com'dan alınan component template'lerini içerir. Bu componentler direkt kullanıma hazır örnekler olup, projenize kopyalayıp özelleştirebilirsiniz.

## İçindekiler

### 1. Web Component Wrapper'lar
Bu componentler Polaris Web Components kullanır ve ekstra bağımlılık gerektirmez.

#### PricingCard
Ücretlendirme planları için kart componenti.

**Props:**
- `title`: Plan başlığı
- `description`: Plan açıklaması (opsiyonel)
- `price`: Fiyat
- `frequency`: Ödeme periyodu (aylık, yıllık, vb.)
- `features`: Özellik listesi (array)
- `featuredText`: Öne çıkarılmış plan badge metni (opsiyonel)
- `button`: Buton konfigürasyonu

**Kullanım:**
```tsx
import { PricingCard } from "@/feature/bite/components/templates/PricingCard/PricingCard";

<PricingCard
  title="Pro"
  price={29}
  frequency="month"
  features={["Feature 1", "Feature 2"]}
  featuredText="Most Popular"
  button={{ content: "Subscribe", props: { variant: "primary" } }}
/>
```

---

#### ActionCard
Aksiyon butonları ve menü içeren kart componenti.

**Props:**
- `title`: Kart başlığı
- `description`: Açıklama metni
- `primaryAction`: Ana aksiyon butonu (opsiyonel)
- `menuActions`: Menü aksiyonları array (opsiyonel)

**Kullanım:**
```tsx
import { ActionCard } from "@/feature/bite/components/templates/ActionCard/ActionCard";

<ActionCard
  title="Payment Settings"
  description="Configure your payment methods"
  primaryAction={{
    content: "Add Payment Method",
    onAction: () => console.log("Add clicked")
  }}
  menuActions={[
    { content: "Edit", onAction: () => {} },
    { content: "Delete", onAction: () => {} }
  ]}
/>
```

---

#### NavCard
Tıklanabilir navigasyon kartı.

**Props:**
- `title`: Başlık
- `description`: Açıklama
- `icon`: İkon adı (opsiyonel)
- `onClick`: Tıklama handler

**Kullanım:**
```tsx
import { NavCard } from "@/feature/bite/components/templates/NavCard/NavCard";

<NavCard
  title="Settings"
  description="Manage your account settings"
  icon="settings"
  onClick={() => navigate("/settings")}
/>
```

---

#### FeedbackCard
Kullanıcı geri bildirimi için thumbs up/down kartı.

**Props:**
- `title`: Başlık
- `description`: Açıklama
- `onPositive`: Thumbs up handler
- `onNegative`: Thumbs down handler
- `onClose`: Kapatma handler

**Kullanım:**
```tsx
import { FeedbackCard } from "@/feature/bite/components/templates/FeedbackCard/FeedbackCard";

<FeedbackCard
  title="Was this helpful?"
  description="Let us know how we're doing"
  onPositive={() => console.log("Positive")}
  onNegative={() => console.log("Negative")}
  onClose={() => setShowFeedback(false)}
/>
```

---

#### Accordion
Genişletilebilir accordion componenti.

**Props:**
- `items`: Accordion item'ları array

**Item yapısı:**
```typescript
{
  id: string | number;
  title: string;
  content: React.ReactNode;
}
```

**Kullanım:**
```tsx
import { Accordion } from "@/feature/bite/components/templates/Accordion/Accordion";

<Accordion
  items={[
    { id: 1, title: "Section 1", content: "Content here..." },
    { id: 2, title: "Section 2", content: "More content..." }
  ]}
/>
```

---

#### Timeline
Zaman çizelgesi componenti.

**Props:**
- `items`: Timeline event'ları array

**Item yapısı:**
```typescript
{
  timestamp: Date;
  timelineEvent: string;
  tone?: "critical" | "caution" | "success" | "base";
  icon?: React.ReactNode;
  url?: string;  // Tıklanabilir yapar
}
```

**Kullanım:**
```tsx
import { Timeline } from "@/feature/bite/components/templates/Timeline/Timeline";

<Timeline
  items={[
    {
      timestamp: new Date(),
      timelineEvent: "Order placed",
      tone: "success",
      url: "/orders/123"
    }
  ]}
/>
```

---

#### ReviewBanner
5 yıldızlı değerlendirme banner'ı.

**Props:**
- `title`: Başlık
- `description`: Açıklama
- `onReview`: Rating callback (1-5)
- `onClose`: Kapatma handler

**Kullanım:**
```tsx
import { ReviewBanner } from "@/feature/bite/components/templates/ReviewBanner/ReviewBanner";

<ReviewBanner
  title="Rate our app"
  description="Help us improve by rating your experience"
  onReview={(rating) => console.log(`Rated: ${rating}`)}
  onClose={() => setShowBanner(false)}
/>
```

---

#### Knob
Toggle switch componenti.

**Props:**
- `ariaLabel`: Accessibility label
- `selected`: Seçili durumu (boolean)
- `onClick`: Toggle handler

**Kullanım:**
```tsx
import { Knob } from "@/feature/bite/components/templates/Knob/Knob";

<Knob
  ariaLabel="Enable notifications"
  selected={notificationsEnabled}
  onClick={() => setNotificationsEnabled(!notificationsEnabled)}
/>
```

---

### 2. React Bağımlılıklı Componentler

#### StatBox
İstatistik kutusu (sparkline chart ile).

**Bağımlılıklar:**
```bash
npm install @shopify/polaris-viz
```

**IMPORTANT:** Bu component client-side rendering gerektirir. Remix/React Router'da `ClientOnly` ile wrap edin:

```tsx
import { ClientOnly } from "remix-utils/client-only";
import { StatBox } from "@/feature/bite/components/templates/StatBox/StatBox";

<ClientOnly fallback={<div>Loading...</div>}>
  {() => (
    <StatBox
      title="Total Sales"
      value="$1,234"
      data={[100, 120, 150, 130, 180]}
    />
  )}
</ClientOnly>
```

**Props:**
- `title`: Başlık
- `value`: Değer (string veya number)
- `data`: Grafik için sayı array (opsiyonel)

---

#### SortableList
Sürüklenebilir liste componenti.

**Bağımlılıklar:**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers @shopify/polaris
```

**Props:**
- `items`: Liste item'ları
- `setItems`: State setter fonksiyonu

**Item yapısı:**
```typescript
{
  id: string | number;
  title: string;
  status?: string;
  [key: string]: any;
}
```

**Kullanım:**
```tsx
import { SortableList } from "@/feature/bite/components/templates/SortableList/SortableList";

const [items, setItems] = useState([
  { id: "1", title: "Item 1", status: "active" },
  { id: "2", title: "Item 2", status: "draft" }
]);

<SortableList items={items} setItems={setItems} />
```

**NOT:** Component dosyasındaki yorum satırlarını kaldırıp bağımlılıkları import edin.

---

#### DateRangePicker
Tarih aralığı seçici.

**Bağımlılıklar:**
```bash
npm install @shopify/polaris
```

**Props:**
- `value`: { start: Date, end: Date }
- `onDateRangeSelect`: Callback fonksiyonu

**Kullanım:**
```tsx
import { DateRangePicker } from "@/feature/bite/components/templates/DateRangePicker/DateRangePicker";

const [dateRange, setDateRange] = useState({
  start: new Date(),
  end: new Date()
});

<DateRangePicker
  value={dateRange}
  onDateRangeSelect={setDateRange}
/>
```

**Önceden tanımlı aralıklar:**
- Today
- Yesterday
- Last 7 days
- Last 30 days
- Last 90 days
- Last 365 days
- Custom

**NOT:** Component dosyasındaki yorum satırlarını kaldırıp bağımlılıkları import edin.

---

#### MediaGrid
Resim yükleme ve grid görünümü.

**Bağımlılıklar:**
```bash
npm install @shopify/polaris
```

**Props:**
- `images`: Resim array
- `setImages`: State setter fonksiyonu

**Image yapısı:**
```typescript
{
  id: string;
  url: string;
  alt?: string;
}
```

**Kullanım:**
```tsx
import { MediaGrid } from "@/feature/bite/components/templates/MediaGrid/MediaGrid";

const [images, setImages] = useState([]);

<MediaGrid images={images} setImages={setImages} />
```

**Özellikler:**
- Drag & drop ile resim yükleme
- Sadece image dosyaları kabul eder
- İlk resim 2x2 grid cell kaplar
- Hover'da silme butonu gösterir

**NOT:** Component dosyasındaki yorum satırlarını kaldırıp bağımlılıkları import edin.

---

#### RichTextEditor
Zengin metin editörü (Quill tabanlı).

**Bağımlılıklar:**
```bash
npm install react-quill
```

**CSS Import:**
```tsx
import "react-quill/dist/quill.snow.css";
```

**Props:**
- `value`: Editor içeriği (HTML string)
- `onChange`: Değişiklik callback
- `label`: Label metni
- `placeholder`: Placeholder metni
- `error`: Hata mesajı
- `disabled`: Disabled durumu
- `modules`: Quill modül konfigürasyonu

**Kullanım:**
```tsx
import { RichTextEditor } from "@/feature/bite/components/templates/RichTextEditor/RichTextEditor";
import "react-quill/dist/quill.snow.css";

const [content, setContent] = useState("");

<RichTextEditor
  label="Description"
  value={content}
  onChange={(value) => setContent(value)}
  placeholder="Enter description..."
  error={errors.description}
/>
```

**Varsayılan toolbar özellikleri:**
- Bold, italic, underline, blockquote
- Ordered/bullet lists
- Indent/outdent
- Links
- Clear formatting

**NOT:** Component dosyasındaki yorum satırlarını kaldırıp bağımlılıkları import edin.

---

#### SetupGuide
Multi-step onboarding/setup wizard componenti.

**Bağımlılıklar:**
```bash
npm install @shopify/polaris @shopify/polaris-icons
```

**Props:**
- `items`: Setup adımları array
- `onDismiss`: Guide'ı kapatma callback
- `onStepComplete`: Adım tamamlama callback (async)

**Item yapısı:**
```typescript
{
  id: number;
  title: string;
  description: string;
  complete: boolean;
  image?: {
    url: string;
    alt?: string;
  };
  primaryButton?: {
    content: string;
    props: {
      url?: string;
      external?: boolean;
      onAction?: () => void;
    };
  };
  secondaryButton?: {
    content: string;
    props: {
      url?: string;
      external?: boolean;
      onAction?: () => void;
    };
  };
}
```

**Kullanım:**
```tsx
import { SetupGuide } from "@/feature/bite/components/templates/SetupGuide/SetupGuide";

const [items, setItems] = useState([
  {
    id: 0,
    title: "Add your first product",
    description: "Get started by adding products to your store...",
    complete: false,
    image: {
      url: "/images/add-product.svg",
      alt: "Add product illustration"
    },
    primaryButton: {
      content: "Add product",
      props: { url: "/products/new" }
    },
    secondaryButton: {
      content: "Import products",
      props: { url: "/products/import" }
    }
  },
  {
    id: 1,
    title: "Share your online store",
    description: "Drive awareness by sharing your store...",
    complete: false,
    primaryButton: {
      content: "Copy store link",
      props: {
        onAction: () => navigator.clipboard.writeText(storeUrl)
      }
    }
  }
]);

<SetupGuide
  items={items}
  onDismiss={() => setShowGuide(false)}
  onStepComplete={async (id) => {
    // Async operation (e.g., API call)
    await updateStepCompletion(id);

    // Update local state
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, complete: !item.complete } : item
    ));
  }}
/>
```

**Özellikler:**
- Progress tracking (X / Y completed)
- Animated progress bar
- Auto-expands first incomplete item
- Only one item expanded at a time
- Collapsible main guide
- Toggle complete/incomplete with loading state
- Custom SVG icons
- Dismiss functionality
- Responsive images (hides on small screens)
- Tooltip on completion button

**NOT:** Component dosyasındaki yorum satırlarını kaldırıp bağımlılıkları import edin.

---

## Kurulum

### Tüm Bağımlılıkları Yükleme (Opsiyonel)

Eğer tüm componentleri kullanmayı planlıyorsanız:

```bash
npm install @shopify/polaris @shopify/polaris-icons @shopify/polaris-viz react-quill @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers
```

### Sadece İhtiyacınız Olanları Yükleme

Her component kendi dosyasında hangi bağımlılıkları gerektirdiğini belirtir. Sadece kullanacağınız componentlerin bağımlılıklarını yükleyin.

## Özelleştirme

Bu componentler template olarak tasarlanmıştır. Projenize kopyalayıp ihtiyacınıza göre özelleştirebilirsiniz:

1. Component dosyasını kendi feature klasörünüze kopyalayın
2. Props interface'ini genişletin veya değiştirin
3. Styling'i CSS module'ü ile özelleştirin
4. İş mantığını projenize göre uyarlayın

## Kaynak

Bu componentler [PolarisComponents.com](https://www.polariscomponents.com) sitesinden alınmıştır.
GitHub Repo: https://github.com/RAAbbott/polaris-components

## Lisans

Bu componentler örnek amaçlıdır ve serbestçe kullanılabilir, değiştirilebilir.
