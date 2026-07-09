import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const { count } = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM sentences",
  ).first<{ count: number }>() ?? { count: 0 };
  return c.json({ status: "ok", sentences: count });
});

export default app;
