import {
	buildPushPayload,
	type PushMessage,
	type PushSubscription,
} from "@block65/webcrypto-web-push";

interface SubscriptionRow {
	id: number;
	subscription: string;
}

export interface PushSendResult {
	id: number;
	status: number | "error";
	detail?: string;
}

/**
 * Sends a push message to every stored subscription.
 * Subscriptions rejected by the push service (404/410) are removed.
 */
export async function sendPushToAll(
	env: Env,
	message: PushMessage,
): Promise<PushSendResult[]> {
	const { results } = await env.DB.prepare(
		"SELECT id, subscription FROM push_subscriptions",
	).all<SubscriptionRow>();

	const vapid = {
		subject: env.VAPID_SUBJECT,
		publicKey: env.VAPID_PUBLIC_KEY,
		privateKey: env.VAPID_PRIVATE_KEY,
	};

	const outcomes: PushSendResult[] = [];
	for (const row of results) {
		try {
			const subscription = JSON.parse(row.subscription) as PushSubscription;
			const payload = await buildPushPayload(message, subscription, vapid);
			const res = await fetch(subscription.endpoint, payload);
			if (res.status === 404 || res.status === 410) {
				await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?")
					.bind(row.id)
					.run();
			}
			outcomes.push({
				id: row.id,
				status: res.status,
				detail: res.ok ? undefined : await res.text(),
			});
			if (!res.ok) {
				console.error(`push failed: ${res.status}`);
			}
		} catch (e) {
			console.error("push send error:", e);
			outcomes.push({
				id: row.id,
				status: "error",
				detail: e instanceof Error ? e.message : String(e),
			});
		}
	}
	return outcomes;
}

/** Daily reminder: notify when there are sentences due for review. */
export async function sendReviewReminder(env: Env) {
	const row = await env.DB.prepare(
		"SELECT COUNT(*) AS count FROM sentences WHERE due_at <= datetime('now')",
	).first<{ count: number }>();
	const due = row?.count ?? 0;
	if (due === 0) return;

	await sendPushToAll(env, {
		data: JSON.stringify({
			title: "osarai",
			body: `今日のおさらいが ${due} 文あります`,
		}),
		options: { ttl: 60 * 60 * 12, urgency: "normal" },
	});
}
