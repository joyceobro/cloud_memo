// public/sw.js

self.addEventListener("push", (event) => {
  if (!event.data) {
    console.error("Push event but no data");
    return;
  }

  console.log("Push received");

  const data = event.data.json();
  const title = data.title || "Cloud Memo";

  const options = {
    body: data.body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    data: {
      url: data.url || "/",
    },
  };

  const showNotificationPromise =
    self.registration.showNotification(title, options);

  const notifyClientsPromise =
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({ type: "new-memo-received" });
      });
    });

  event.waitUntil(
    Promise.all([showNotificationPromise, notifyClientsPromise])
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
