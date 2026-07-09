import type { JudgeResult, Sentence, Stats, Suggestion } from "../shared/types";

/** D1 stores UTC "YYYY-MM-DD HH:MM:SS" */
export function parseSqliteDate(sqlite: string): Date {
	return new Date(`${sqlite.replace(" ", "T")}Z`);
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		headers: { "content-type": "application/json" },
		...init,
	});
	const body = (await res.json().catch(() => null)) as
		| (T & { error?: string })
		| null;
	if (!res.ok) {
		throw new ApiError(
			body?.error ?? `リクエストに失敗しました (${res.status})`,
			res.status,
		);
	}
	if (body === null) {
		throw new ApiError("サーバーの応答を読み取れませんでした", res.status);
	}
	return body;
}

export const api = {
	suggest: (ja: string) =>
		request<{ suggestions: Suggestion[] }>("/api/suggest", {
			method: "POST",
			body: JSON.stringify({ ja }),
		}),
	listSentences: () => request<{ sentences: Sentence[] }>("/api/sentences"),
	createSentence: (input: { ja: string; en: string; note?: string | null }) =>
		request<{ sentence: Sentence }>("/api/sentences", {
			method: "POST",
			body: JSON.stringify(input),
		}),
	deleteSentence: (id: number) =>
		request<{ ok: boolean }>(`/api/sentences/${id}`, { method: "DELETE" }),
	reviewQueue: () => request<{ sentences: Sentence[] }>("/api/review/queue"),
	stats: () => request<Stats>("/api/stats"),
	judge: (id: number, answer: string) =>
		request<JudgeResult & { sentence: Sentence }>(`/api/review/${id}/judge`, {
			method: "POST",
			body: JSON.stringify({ answer }),
		}),
};

export function speak(text: string) {
	if (!("speechSynthesis" in window)) return;
	speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = "en-US";
	utterance.rate = 0.95;
	speechSynthesis.speak(utterance);
}
