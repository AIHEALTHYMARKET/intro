// 自動提醒信：預約時間前 24 小時 / 1 小時 / 5 分鐘各寄一次（由 GitHub Actions 每 5 分鐘執行）
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
const tx = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS } });

const DEF = {
  title: '線上說明會', tz: 'Asia/Kuala_Lumpur', site: process.env.SITE_URL || '',
  remind_subj: '【{when}開始】{title}（{slot}）',
  remind_body: '{name} 您好，\n\n您預約的「{title}」將於{when}開始。\n預約時間：{slot}\n\n👉 專屬觀看鏈接：{link}\n\n（請勿轉發）'
};
// [提前毫秒, 文字, 紀錄欄位]，由早到晚
const R = [[86400000, '24 小時後', 'h24'], [3600000, '1 小時後', 'h1'], [300000, '5 分鐘後', 'm5']];

(async () => {
  const c = Object.assign({}, DEF, (await db.doc('config/main').get()).data() || {});
  const now = Date.now();
  const snap = await db.collection('regs').where('slot', '>', now - 600000).get();
  for (const d of snap.docs) {
    const r = d.data(), sent = r.sent || {};
    const due = R.filter(([off, , k]) => !sent[k] && now >= r.slot - off && now < r.slot + (k === 'm5' ? 300000 : 0));
    if (!due.length) continue;
    const [off, when, key] = due[due.length - 1];           // 同時到期只寄最近的一封
    due.forEach(([, , k]) => sent[k] = 'skip');
    const lateBooking = key !== 'm5' && r.ts > r.slot - off + 300000; // 報名時已經過了這個提醒點就不寄
    if (!lateBooking) {
      const slotTxt = new Date(r.slot).toLocaleString('zh-TW', { timeZone: c.tz, month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
      const fill = t => String(t).replace(/{title}/g, c.title).replace(/{name}/g, r.name).replace(/{slot}/g, slotTxt)
        .replace(/{when}/g, when).replace(/{link}/g, (c.site || process.env.SITE_URL) + '?w=' + d.id);
      try {
        await tx.sendMail({ from: `"${c.title}" <${process.env.GMAIL_USER}>`, to: r.email, subject: fill(c.remind_subj), text: fill(c.remind_body) });
        sent[key] = now; console.log('sent', key, r.email);
      } catch (e) { console.error('fail', r.email, e.message); delete sent[key]; }
    }
    await d.ref.update({ sent });
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
