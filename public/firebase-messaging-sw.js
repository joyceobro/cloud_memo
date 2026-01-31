// public/sw.js
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-sw.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-sw.js');

// 앱과 동일한 설정값 (반드시 동일해야 함!)
firebase.initializeApp({
  apiKey: "AIzaSyAAqorZd78VjeaS7LxA3DykrR-zjb2jf6E",
  authDomain: "soaho-5b92f.firebaseapp.com",
  projectId: "soaho-5b92f",
  storageBucket: "soaho-5b92f.firebasestorage.app",
  messagingSenderId: "655094826656",
  appId: "1:655094826656:web:503233d31c9ca8c2f5abc5"
});

const messaging = firebase.messaging();

// 백그라운드 메시지 처리
messaging.onBackgroundMessage((payload) => {
  console.log('🔔 [SW] 백그라운드 메시지 수신:', payload);

  const notificationTitle = payload.notification.title || "새 메모";
  const notificationOptions = {
    body: payload.notification.body || "메모가 도착했습니다!",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    data: payload.data // 클릭 시 이동할 URL 등을 담을 수 있음
  };

  // 알림 띄우기
  self.registration.showNotification(notificationTitle, notificationOptions);
});