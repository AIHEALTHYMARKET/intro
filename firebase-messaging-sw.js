// 背景推播（網站關閉時也能收到通知）。不需要修改。
self.window = self;
importScripts(
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js',
  'config.js'
);
firebase.initializeApp(Object.assign(
  { messagingSenderId: (self.CONF.firebase.appId || '').split(':')[1] },
  self.CONF.firebase
));
firebase.messaging();
