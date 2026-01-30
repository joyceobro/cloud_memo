// public/sw.js

self.addEventListener("push", (event) => {
  if (!event.data) {
    console.error("Push event but no data");
    return;
  }
  const data = event.data.json();
  const title = data.title || "Cloud Memo";
  const options = {
    body: data.body,
    icon: "icons/icon-192x192.png", // 알림에 표시할 아이콘
    badge: "icons/icon-96x96.png", // 안드로이드에서 사용되는 뱃지
    data: {
      url: data.url || "/", // 알림 클릭 시 이동할 URL
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));

  // 열려있는 탭에 메시지를 보내서 실시간으로 내용을 업데이트 하도록 함
  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(clientList => {
      clientList.forEach(client => {
        // 'new-memo-received' 메시지를 보내 app.js가 목록을 새로고침하게 만듬
        client.postMessage({ type: 'new-memo-received' });
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  // 알림창 닫기
  event.notification.close();

  const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clientList) => {
      // 이미 해당 페이지가 열려있는지 확인하고, 열려있으면 포커스
      for (const client of clientList) {
        if (client.url === urlToOpen && "focus" in client) {
          return client.focus();
        }
      }
      // 열려있지 않다면 새 탭에서 연다
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
