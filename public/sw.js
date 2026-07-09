/* Service worker: receives review-reminder pushes. */

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
	let data = { title: "osarai", body: "おさらいの時間です" };
	try {
		if (event.data) data = { ...data, ...event.data.json() };
	} catch {
		/* keep defaults */
	}
	event.waitUntil(
		self.registration.showNotification(data.title, {
			body: data.body,
			icon: "/icons/icon-192.png",
			badge: "/icons/icon-192.png",
			data: { url: "/" },
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clients) => {
				for (const client of clients) {
					if ("focus" in client) return client.focus();
				}
				return self.clients.openWindow("/");
			}),
	);
});
