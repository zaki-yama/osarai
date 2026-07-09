import { Hono } from "hono";
import { judgeAnswer, suggestTranslations } from "./gemini";
import { nextSrsState } from "./srs";
import type { JudgeResult, Sentence } from "../shared/types";

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
		"SELECT * FROM sentences ORDER BY created_at DESC, id DESC",
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

export default app;
