// 自動提醒：Email（預約前 24 小時 / 1 小時 / 5 分鐘）＋ 推播給發展者與管理員
// （預約前 10 分鐘；選「馬上觀看」者報名後立即推播）。由 GitHub Actions / cron-job.org 定時執行。
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
const R = [[86400000, '24 小時後', 'h24'], [3600000, '1 小時後', 'h1'], [300000, '5 分鐘後', 'm5']];

(async () => {
  const c = Object.assign({}, DEF, (await db.doc('config/main').get()).data() || {});
  const site = c.site || process.env.SITE_URL || '';
  const now = Date.now();
  const PT = (await db.collection('push').get()).docs.map(d => ({ id: d.id, ...d.data() }));

  async function notify(r, title, body) {
    const groups = [
      [PT.filter(p => p.role === 'admin'), site + '?admin'],
      [PT.filter(p => p.role === 'leader' && r.leader && p.code === r.leader), site + '?dev']
    ];
    for (const [list, url] of groups) {
      if (!list.length) continue;
      const res = await admin.messaging().sendEachForMulticast({
        tokens: list.map(p => p.id), notification: { title, body }, webpush: { fcmOptions: { link: url } }
      });
      res.responses.forEach((x, i) => {
        if (!x.success && /not-registered|invalid-registration/.test((x.error && x.error.code) || ''))
          db.doc('push/' + list[i].id).delete().catch(() => {});
      });
      console.log('push', title, 'devices:', list.length);
    }
  }

  // A) 預約者：Email 提醒 + 開始前 10 分鐘推播
  const snapA = await db.collection('regs').where('slot', '>', now - 900000).where('slot', '<', now + 90000000).get();
  console.log('預約者數量', snapA.size);
  for (const d of snapA.docs) {
    const r = d.data(), sent = r.sent || {};
    const slotTxt = new Date(r.slot).toLocaleString('zh-TW', { timeZone: c.tz, month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
    const due = R.filter(([off, , k]) => !sent[k] && now >= r.slot - off && now < r.slot + (k === 'm5' ? 300000 : 0));
    if (due.length) {
      const [off, when, key] = due[due.length - 1];
      due.forEach(([, , k]) => sent[k] = 'skip');
      if (key !== 'm5' && r.ts > r.slot - off + 300000) {
        console.log('略過（報名時已過此提醒時間點）', key, r.email);
      } else {
        const fill = t => String(t).replace(/{title}/g, c.title).replace(/{name}/g, r.name).replace(/{slot}/g, slotTxt)
          .replace(/{when}/g, when).replace(/{link}/g, site + '?w=' + d.id);
        try {
          await tx.sendMail({ from: `"${c.title}" <${process.env.GMAIL_USER}>`, to: r.email, subject: fill(c.remind_subj), text: fill(c.remind_body) });
          sent[key] = now; console.log('已寄出提醒信', key, r.email);
        } catch (e) { console.error('寄信失敗', r.email, e.message); delete sent[key]; }
      }
      await d.ref.update({ sent });            // 先存紀錄，避免後面推播出錯造成重複寄信
    }
    if (!r.pushed10 && !r.fu && now >= r.slot - 600000 && now < r.slot + 600000) {
      try {
        await notify(r, `⏰ 10 分鐘後開始：${r.name}`, `預約 ${slotTxt}，請準備用 WhatsApp 跟進 ${r.name}（${r.phone}）`);
        await d.ref.update({ pushed10: now });
      } catch (e) { console.error('推播失敗', e.message); }
    }
  }

  // B) 選「馬上觀看」者：報名後立即推播
  const snapB = await db.collection('regs').where('ts', '>', now - 6 * 3600000).get();
  for (const d of snapB.docs) {
    const r = d.data();
    if (r.slot || r.pushedNow) continue;
    try {
      await notify(r, `🔔 新報名（馬上觀看）：${r.name}`, `請立即用 WhatsApp 聯絡 ${r.name}（${r.phone}）`);
      await d.ref.update({ pushedNow: now });
    } catch (e) { console.error('推播失敗', e.message); }
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
