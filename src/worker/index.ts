import { Hono } from "hono";
import { suggestTranslations } from "./gemini";
import type { Sentence } from "../shared/types";

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

export default app;
