# SWUS ERP v2

নতুন ERP — পুরানো (Lovable) ERP-এর পাশাপাশি চলে, **একই Supabase database** ব্যবহার করে।
কোনো data কপি বা migrate করা হয় না; একই login, একই RLS, একই DB functions।

## চালানো
```
npm install
cp .env.example .env   # Supabase URL + publishable key
npm run dev
```

## Deploy (Vercel)
Framework: Vite · Build: `npm run build` · Output: `dist`
Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_LEGACY_ERP_URL`.

## নিয়ম (নিরাপত্তার জন্য)
- Status বদলায় শুধু `transition_order_status` / `bulk_transition_order_status` দিয়ে — পুরানো ERP-র মতোই, তাই সব trigger (stock, finance) একই থাকে।
- Return receive হয় `confirm_return_received` দিয়ে (শুধু "good" হলে restock)।
- Courier booking ছাড়া কোনো order "shipped" করা যায় না।
- দিনের হিসাব সবসময় Asia/Dhaka সময়ে।
- `paid` = delivered + টাকা পাওয়া; delivered গ্রুপে ধরা হয় (পুরানো dashboard RPC এটা বাদ দিত)।
- Website-এর মৃত lead (`status=new`, `web_status` cancelled/complete) কাজের list-এ দেখায় না।

## যা তৈরি
Dashboard · Orders (list, drawer, bulk) · নতুন Order · Dispatch (pick list + scan) · Products & Stock · Customers · Returns · COD Reconciliation

## বাকি
Courier booking API (Pathao/Steadfast, server function) · Finance · Marketing · Reports · Imports/PO · Stocktake · HR · Settings
