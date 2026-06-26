<div align="center">

<br/>

```
   ─────────────────────────────────────
          A  U  R  U  M
        L U X U R Y   B O U T I Q U E
   ─────────────────────────────────────
```

<br/>

*A full-stack luxury e-commerce experience — crafted in React & Supabase*

<br/>

![React](https://img.shields.io/badge/React-18-black?style=flat-square&logo=react&logoColor=61DAFB)
![Supabase](https://img.shields.io/badge/Supabase-Database-black?style=flat-square&logo=supabase&logoColor=3ECF8E)
![Razorpay](https://img.shields.io/badge/Razorpay-Payments-black?style=flat-square&logo=razorpay&logoColor=white)
![CSS Modules](https://img.shields.io/badge/CSS-Modules-black?style=flat-square&logo=cssmodules&logoColor=white)
![MIT License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

<br/>

</div>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Overview

> Aurum is a premium luxury boutique platform — blending refined aesthetics with a complete commerce stack. Customers browse, cart and checkout seamlessly. The owner manages everything from a private dashboard — products, images, inventory and orders — in real time.

<br/>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Features

<br/>

**Storefront**

&nbsp;&nbsp;&nbsp;&nbsp;`🏛` &nbsp; Hero landing with brand promise & featured collections  
&nbsp;&nbsp;&nbsp;&nbsp;`🛍` &nbsp; Shop with category filters, price sort & live search  
&nbsp;&nbsp;&nbsp;&nbsp;`💎` &nbsp; Product detail pages with gallery, quantity & wishlist  
&nbsp;&nbsp;&nbsp;&nbsp;`🛒` &nbsp; Cart with live subtotal, 18% GST & Razorpay checkout  
&nbsp;&nbsp;&nbsp;&nbsp;`👤` &nbsp; Customer auth — sign up, sign in, sign out  
&nbsp;&nbsp;&nbsp;&nbsp;`📦` &nbsp; Order history & email confirmations via Resend  

<br/>

**Owner Dashboard**

&nbsp;&nbsp;&nbsp;&nbsp;`🔑` &nbsp; Separate owner portal with role-based access  
&nbsp;&nbsp;&nbsp;&nbsp;`📊` &nbsp; Live stats — inventory value, low-stock alerts, revenue  
&nbsp;&nbsp;&nbsp;&nbsp;`🖼` &nbsp; Product management with **multi-image upload** (up to 10 images)  
&nbsp;&nbsp;&nbsp;&nbsp;`📦` &nbsp; Order management with real-time status updates  
&nbsp;&nbsp;&nbsp;&nbsp;`✨` &nbsp; Category breakdown & recent orders panel  

<br/>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Tech Stack

<br/>

| Layer | Technology |
|---|---|
| Frontend | React 18, CSS Modules |
| Backend & Auth | Supabase (PostgreSQL + RLS) |
| Payments | Razorpay |
| Email | Resend + Supabase Edge Functions |
| Fonts | Cormorant Garamond · Montserrat |
| Deploy | Vercel / Netlify |

<br/>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Getting Started

<br/>

**1 — Install**

```bash
cd aurum-luxury
npm install
```

<br/>

**2 — Configure Supabase** *(optional — app works in demo mode without this)*

```bash
cp .env.example .env
```

Add your credentials from **Supabase → Settings → API:**

```env
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
```

Run the schema in **Supabase → SQL Editor:**

```bash
# paste contents of supabase_schema.sql and hit Run
```

Then add image columns:

```sql
ALTER TABLE products
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS images    TEXT[];
```

<br/>

**3 — Create Owner Account**

```
Email    → owner@aurum.com
Password → owner123
```

```sql
UPDATE public.profiles
SET role = 'owner'
WHERE email = 'owner@aurum.com';
```

<br/>

**4 — Run**

```bash
npm start
# → http://localhost:3000
```

<br/>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Demo Mode

> No Supabase? No problem. The app runs fully offline with mock data.

```
Owner login   →   owner@aurum.com  /  owner123
Customer      →   any email  +  any 6-char password
```

10 pre-loaded luxury products across 4 categories. Cart persists via `localStorage`. Product edits reset on page refresh.

<br/>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Database

<br/>

| Table | Description |
|---|---|
| `profiles` | Extends auth.users — stores `role` (customer / owner) |
| `products` | Catalogue — name, price, stock, images, category |
| `orders` | Orders with status tracking & payment info |
| `order_items` | Line items per order |
| `wishlist` | User × product wishlist |

<br/>

**Row Level Security** — customers see only their own orders & profile. Owners have full product & order access. Products are publicly readable.

<br/>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Design Tokens

<br/>

```
  Gold          #C9A84C     ████
  Gold Dark     #9B7D2F     ████
  Charcoal      #1A1714     ████
  Cream         #FAF8F3     ████

  Display  →  Cormorant Garamond
  Body     →  Montserrat
```

<br/>

---

<br/>

## &nbsp;&nbsp;✦ &nbsp; Deploy

<br/>

```bash
npm run build

# Vercel (recommended)
npx vercel
```

Set `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` in your hosting dashboard.

<br/>

---

<br/>

<div align="center">

```
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
        MIT License  ·  Aurum 2026
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

*Crafted with intention. Built for luxury.*

</div>

<br/>
