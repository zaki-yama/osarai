import { Hono } from "hono";
import { judgeAnswer, suggestTranslations } from "./gemini";
import { sendPushToAll, sendReviewReminder } from "./push";
import { nextSrsState } from "./srs";
import type { JudgeResult, Sentence } from "../shared/types";
import { MASTERY_STREAK } from "../shared/srs";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
	const row = await c.env.DB.prepare(
		"SELECT COUNT(*) AS count FROM sentences",
	).first<{ count: number }>();
	return c.json({ status: "ok", sentences: row?.count ?? 0 });
});

app.post("/api/suggest", async (c) => {
	const body = await c.req
		.json<{ ja?: string }>()
		.catch(() => ({}) as { ja?: string });
	const ja = body.ja?.trim();
	if (!ja) {
		return c.json({ error: "ja is required" }, 400);
	}
	if (!c.env.GEMINI_API_KEY) {
		return c.json({ error: "GEMINI_API_KEY is not configured" }, 500);
	}
	try {
		const suggestions = await suggestTranslations(c.env, ja);
		return c.json({ suggestions });
	} catch (e) {
		console.error("suggest failed:", e);
		return c.json({ error: "例文の生成に失敗しました" }, 502);
	}
});

app.get("/api/sentences", async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT s.*, COUNT(r.id) AS review_count
		 FROM sentences s
		 LEFT JOIN reviews r ON r.sentence_id = s.id
		 GROUP BY s.id
		 ORDER BY s.created_at DESC, s.id DESC`,
	).all<Sentence>();
	return c.json({ sentences: results });
});

app.post("/api/sentences", async (c) => {
	const body = await c.req
		.json<{ ja?: string; en?: string; note?: string | null }>()
		.catch(() => ({}) as { ja?: string; en?: string; note?: string | null });
	const ja = body.ja?.trim();
	const en = body.en?.trim();
	if (!ja || !en) {
		return c.json({ error: "ja and en are required" }, 400);
	}
	const sentence = await c.env.DB.prepare(
		"INSERT INTO sentences (ja, en, note, due_at) VALUES (?, ?, ?, datetime('now')) RETURNING *",
	)
		.bind(ja, en, body.note?.trim() || null)
		.first<Sentence>();
	return c.json({ sentence }, 201);
});

app.delete("/api/sentences/:id", async (c) => {
	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "invalid id" }, 400);
	}
	await c.env.DB.prepare("DELETE FROM sentences WHERE id = ?").bind(id).run();
	return c.json({ ok: true });
});

app.get("/api/review/queue", async (c) => {
	const { results } = await c.env.DB.prepare(
		"SELECT * FROM sentences WHERE due_at <= datetime('now') ORDER BY due_at ASC, id ASC",
	).all<Sentence>();
	return c.json({ sentences: results });
});

app.post("/api/review/:id/judge", async (c) => {
	const id = Number(c.req.param("id"));
	if (!Number.isInteger(id) || id <= 0) {
		return c.json({ error: "invalid id" }, 400);
	}
	const body = await c.req
		.json<{ answer?: string }>()
		.catch(() => ({}) as { answer?: string });
	const answer = body.answer?.trim();
	if (!answer) {
		return c.json({ error: "answer is required" }, 400);
	}
	const sentence = await c.env.DB.prepare(
		"SELECT * FROM sentences WHERE id = ?",
	)
		.bind(id)
		.first<Sentence>();
	if (!sentence) {
		return c.json({ error: "sentence not found" }, 404);
	}
	if (!c.env.GEMINI_API_KEY) {
		return c.json({ error: "GEMINI_API_KEY is not configured" }, 500);
	}

	let result: JudgeResult;
	try {
		result = await judgeAnswer(c.env, sentence, answer);
	} catch (e) {
		console.error("judge failed:", e);
		return c.json({ error: "採点に失敗しました" }, 502);
	}

	const srs = nextSrsState(sentence, result.correct);
	const updated = await c.env.DB.prepare(
		`UPDATE sentences
		 SET interval_days = ?, ease = ?, streak = ?,
		     due_at = datetime('now', '+' || ? || ' seconds')
		 WHERE id = ? RETURNING *`,
	)
		.bind(
			srs.intervalDays,
			srs.ease,
			srs.streak,
			Math.round(srs.dueInDays * 86400),
			id,
		)
		.first<Sentence>();
	await c.env.DB.prepare(
		"INSERT INTO reviews (sentence_id, correct, spoken_text, judge_comment) VALUES (?, ?, ?, ?)",
	)
		.bind(id, result.correct ? 1 : 0, answer, result.comment)
		.run();

	return c.json({ ...result, sentence: updated });
});

app.get("/api/stats", async (c) => {
	const [totals, reviewTotals, activeDays, daily] = await Promise.all([
		c.env.DB.prepare(
			"SELECT COUNT(*) AS total, SUM(CASE WHEN streak >= ? THEN 1 ELSE 0 END) AS mastered FROM sentences",
		)
			.bind(MASTERY_STREAK)
			.first<{ total: number; mastered: number | null }>(),
		c.env.DB.prepare(
			"SELECT COUNT(*) AS total, SUM(correct) AS correct FROM reviews",
		).first<{ total: number; correct: number | null }>(),
		// Days (in JST) that have at least one review, newest first.
		c.env.DB.prepare(
			"SELECT DISTINCT date(reviewed_at, '+9 hours') AS day FROM reviews ORDER BY day DESC LIMIT 366",
		).all<{ day: string }>(),
		c.env.DB.prepare(
			`SELECT date(reviewed_at, '+9 hours') AS day,
			        COUNT(*) AS total, SUM(correct) AS correct
			 FROM reviews
			 WHERE reviewed_at >= datetime('now', '-14 days')
			 GROUP BY day ORDER BY day ASC`,
		).all<{ day: string; total: number; correct: number }>(),
	]);

	// Consecutive study days ending today or yesterday (JST).
	const days = new Set(activeDays.results.map((r) => r.day));
	const jstNow = new Date(Date.now() + 9 * 3600_000);
	const cursor = new Date(jstNow);
	const toKey = (d: Date) => d.toISOString().slice(0, 10);
	let studyStreak = 0;
	if (!days.has(toKey(cursor))) {
		cursor.setUTCDate(cursor.getUTCDate() - 1); // today not studied yet — count from yesterday
	}
	while (days.has(toKey(cursor))) {
		studyStreak++;
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}

	return c.json({
		sentences: totals?.total ?? 0,
		mastered: totals?.mastered ?? 0,
		reviews: reviewTotals?.total ?? 0,
		correct: reviewTotals?.correct ?? 0,
		studyStreak,
		daily: daily.results,
	});
});

app.get("/api/push/public-key", (c) =>
	c.json({ key: c.env.VAPID_PUBLIC_KEY }),
);

app.post("/api/push/subscribe", async (c) => {
	const subscription = await c.req.json<{ endpoint?: string }>().catch(() => null);
	if (!subscription?.endpoint) {
		return c.json({ error: "invalid subscription" }, 400);
	}
	await c.env.DB.prepare(
		"DELETE FROM push_subscriptions WHERE json_extract(subscription, '$.endpoint') = ?",
	)
		.bind(subscription.endpoint)
		.run();
	await c.env.DB.prepare(
		"INSERT INTO push_subscriptions (subscription) VALUES (?)",
	)
		.bind(JSON.stringify(subscription))
		.run();
	return c.json({ ok: true }, 201);
});

app.post("/api/push/unsubscribe", async (c) => {
	const body = await c.req.json<{ endpoint?: string }>().catch(() => null);
	if (!body?.endpoint) {
		return c.json({ error: "endpoint is required" }, 400);
	}
	await c.env.DB.prepare(
		"DELETE FROM push_subscriptions WHERE json_extract(subscription, '$.endpoint') = ?",
	)
		.bind(body.endpoint)
		.run();
	return c.json({ ok: true });
});

app.post("/api/push/test", async (c) => {
	const results = await sendPushToAll(c.env, {
		data: JSON.stringify({
			title: "osarai",
			body: "テスト通知です。通知の設定は完了しています!",
		}),
		options: { ttl: 60 * 5, urgency: "high" },
	});
	return c.json({ results });
});

export default {
	fetch: app.fetch,
	scheduled: async (_controller, env) => {
		try {
			await sendReviewReminder(env);
		} catch (e) {
			console.error("scheduled failed:", e);
			throw e;
		}
	},
} satisfies ExportedHandler<Env>;
