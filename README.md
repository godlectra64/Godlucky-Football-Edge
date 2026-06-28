# Godlucky Football Edge

Ultimate Real Data Version สำหรับวิเคราะห์ฟุตบอลแบบ mobile-first PWA โดยใช้ Supabase Database, Supabase Edge Functions และข้อมูลจริงจาก football-data.org v4

## ฟีเจอร์หลัก

- หน้า Today แสดง "Top 10 คู่เด่นวันนี้และพรุ่งนี้" จากข้อมูลจริงใน Supabase
- Ranking เรียงจาก confidence สูง, risk ต่ำ, league priority สูง และ data completeness สูง
- Match Detail แสดงคะแนนแต่ละโมดูล, ฟอร์ม 5 นัดหลัง, ประตูได้เสีย, ตารางคะแนนถ้ามี, เหตุผลภาษาไทย และข้อควรระวัง
- หน้า Admin เรียก Edge Function `sync-football-data` เพื่อ manual sync แล้ว refresh รายการล่าสุด
- API-Football enrichment modes are admin-only. See `docs/admin-enrichment-invoke.md` for service role/admin JWT invoke examples.
- Daily full sync is available through the admin-only `daily-full-sync` mode. See `docs/admin-daily-full-sync.md`.
- หน้า Result Tracker และ Stats อ่านข้อมูล sync ล่าสุดจากฐานข้อมูล
- Demo data ใช้เฉพาะ dev fallback เมื่อยังไม่ได้ตั้งค่า `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY`

## ENV

Frontend ใช้เฉพาะค่า public ของ Supabase:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Football API token ห้ามใส่ใน frontend ให้ตั้งเป็น Supabase Edge Function secrets เท่านั้น:

```bash
FOOTBALL_API_BASE_URL=https://api.football-data.org/v4
FOOTBALL_API_KEY=your_football_data_token
```

## คำสั่ง

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Deploy Edge Function

```bash
supabase functions deploy sync-football-data --project-ref fzjbnxomflqopwhzxfog
supabase secrets set FOOTBALL_API_KEY=your_key FOOTBALL_API_BASE_URL=https://api.football-data.org/v4 --project-ref fzjbnxomflqopwhzxfog
```

## ตั้ง Cron Sync

รันไฟล์ `supabase/cron/sync-football-data.sql` ใน Supabase SQL Editor ของ project `fzjbnxomflqopwhzxfog`

ก่อนรัน schedule ให้ตั้งค่า database setting สำหรับ service role key:

```sql
alter database postgres set app.supabase_service_role_key = '<your service role key>';
```

จากนั้นเปิด Supabase SQL Editor แล้ว paste/run SQL จาก:

```text
supabase/cron/sync-football-data.sql
```

Cron จะเรียก Edge Function:

```text
https://fzjbnxomflqopwhzxfog.functions.supabase.co/sync-football-data
```

รอบเวลาไทย:

- 00:05
- 06:00
- 12:00
- 18:00

Edge Function จะ sync เฉพาะวันนี้และพรุ่งนี้ และบันทึกผลลง `sync_logs` ทุกครั้ง
