function urlBase64ToUint8Array(base64: string): Uint8Array {
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
	return (
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

export async function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) return null;
	return navigator.serviceWorker.register("/sw.js");
}

export async function getSubscription(): Promise<PushSubscription | null> {
	if (!pushSupported()) return null;
	const registration = await navigator.serviceWorker.ready;
	return registration.pushManager.getSubscription();
}

export async function subscribePush(): Promise<void> {
	const permission = await Notification.requestPermission();
	if (permission !== "granted") {
		throw new Error("通知が許可されませんでした");
	}
	const registration = await navigator.serviceWorker.ready;
	const { key } = (await (await fetch("/api/push/public-key")).json()) as {
		key: string;
	};
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
	});
	const res = await fetch("/api/push/subscribe", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(subscription.toJSON()),
	});
	if (!res.ok) {
		await subscription.unsubscribe();
		throw new Error("購読の登録に失敗しました");
	}
}

export async function unsubscribePush(): Promise<void> {
	const subscription = await getSubscription();
	if (!subscription) return;
	await fetch("/api/push/unsubscribe", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ endpoint: subscription.endpoint }),
	});
	await subscription.unsubscribe();
}
