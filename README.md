# osarai

English conversation review app with spaced repetition.
「おさらい」= review in Japanese.

After an English conversation lesson, register sentences you learned (or couldn't express) in Japanese. The app suggests natural English translations via LLM, then quizzes you with spaced repetition (SRS) — you speak the English sentence and the LLM judges whether your answer conveys the same meaning.

See [docs/spec.md](docs/spec.md) for the full spec and implementation plan (Japanese).

## Tech stack

- [Hono](https://hono.dev/) + React SPA (Vite) on Cloudflare Workers
- Cloudflare D1 (SQLite)
- Gemini API (example generation & answer judging)
- Web Speech API (speech recognition) / SpeechSynthesis (text-to-speech)
- PWA + Web Push (review reminders)

## Development

```sh
pnpm install
pnpm exec wrangler d1 migrations apply osarai --local
pnpm run dev
```

## Deployment

```sh
pnpm exec wrangler d1 migrations apply osarai --remote
pnpm run deploy
```
