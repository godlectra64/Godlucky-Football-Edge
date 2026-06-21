# Godlucky Football Edge

PWA mobile-first สำหรับวิเคราะห์บอลบน Android ด้วย React, Vite, Tailwind CSS และ LocalStorage โดยยังไม่ต่อ backend หรือ API จริง

## ฟีเจอร์หลัก

- หน้า “คู่เด็ดวันนี้” แสดง Top 10 จาก demo 12 คู่ โดยคัดจาก `selectionScore`
- หน้า Match Detail แสดงคะแนน 8 โมดูล, market edge, risk, เหตุผลสนับสนุน และข้อควรระวัง
- หน้า Admin เพิ่ม แก้ไข ลบ รีเซ็ต demo และแก้คะแนนคัดเลือก/คะแนนวิเคราะห์ได้
- หน้า Result Tracker บันทึกผล Win / Lose / Push / Pending
- หน้า Stats คำนวณ winrate และ ROI แบบง่ายจากผลจริงใน LocalStorage
- PWA พร้อม manifest และ service worker จาก `vite-plugin-pwa`

## คำสั่ง

```bash
npm install
npm run dev
npm run build
npm run lint
```
