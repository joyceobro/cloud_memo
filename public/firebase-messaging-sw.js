// public/sw.js

self.addEventListener("push", (event) => {
  console.log("🔔 [SW] Push received");

  let data = { title: "새 메모", body: "메모가 도착했습니다!" };

  if (event.data) {
    try {
      data = event.data.json();
      console.log("📦 [SW] Payload:", data);
    } catch (e) {
      console.error("❌ JSON 파싱 에러:", e);
      // 데이터가 JSON이 아니면 그냥 텍스트로라도 보여줌
      data = { title: "새 메모", body: event.data.text() };
    }
  }

  // 알림 띄우기 (이 코드가 실행되어야 배너가 뜸)
  const promiseChain = self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png"
  });

  // 앱 화면에 새로고침 신호 보내기
  const messageChain = self.clients.matchAll({ type: "window" }).then(clients => {
    clients.forEach(client => client.postMessage({ type: "new-memo-received" }));
  });

  event.waitUntil(Promise.all([promiseChain, messageChain]));
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
