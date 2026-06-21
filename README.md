# Godlucky Football Edge

Ultimate Real Data Version สำหรับวิเคราะห์ฟุตบอลแบบ mobile-first PWA โดยใช้ Supabase Database, Supabase Edge Functions และข้อมูลฟุตบอลจริงจาก provider ที่ตั้งค่าใน Supabase secrets

## ฟีเจอร์หลัก

- หน้า “Top 10 คู่เด่นวันนี้” อ่านข้อมูลจาก Supabase เป็นหลัก
- หน้า Match Detail แสดงคะแนนวิเคราะห์ 8 โมดูล, ฟอร์ม 5 นัดหลัง, สถิติยิงได้/เสีย และเหตุผลภาษาไทย
- หน้า Admin เรียก Edge Function เพื่อ sync ข้อมูลวันนี้, อ่าน Sync Logs, เปิด/ปิดลีก และจัดลำดับความสำคัญลีก
- หน้า Result Tracker แสดงสถานะการแข่งขันและสกอร์จากข้อมูล sync ล่าสุด
- หน้า Stats คำนวณภาพรวมจากข้อมูลจริงใน Supabase
- Demo data ใช้เป็น dev fallback เท่านั้นเมื่อยังไม่ตั้งค่า `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY`

## ENV

คัดลอกจาก `.env.example` เป็น `.env.local`

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
FOOTBALL_API_BASE_URL=
FOOTBALL_API_KEY=
```

ใช้เฉพาะ `VITE_*` ใน frontend ส่วน `FOOTBALL_API_KEY` ต้องตั้งเป็น Supabase secret สำหรับ Edge Function เท่านั้น

## คำสั่ง

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Deploy Edge Function

```bash
supabase functions deploy sync-football-data
supabase secrets set FOOTBALL_API_KEY=your_key FOOTBALL_API_BASE_URL=https://v3.football.api-sports.io
```

## ตั้ง Cron

รัน SQL ใน `supabase/cron/sync-football-data.sql` หลังตั้งค่า `app.supabase_url` และ `app.supabase_service_role_key` ใน Supabase database settings
