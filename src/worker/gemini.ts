import type { Suggestion } from "../shared/types";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

const SUGGEST_SCHEMA = {
	type: "OBJECT",
	properties: {
		suggestions: {
			type: "ARRAY",
			items: {
				type: "OBJECT",
				properties: {
					en: { type: "STRING" },
					style: { type: "STRING" },
					explanation: { type: "STRING" },
				},
				required: ["en", "style", "explanation"],
			},
		},
	},
	required: ["suggestions"],
};

interface GeminiResponse {
	candidates?: {
		content?: { parts?: { text?: string }[] };
	}[];
}

async function generateJson<T>(
	env: Env,
	prompt: string,
	responseSchema: unknown,
): Promise<T> {
	const model = env.GEMINI_MODEL || DEFAULT_MODEL;
	const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-goog-api-key": env.GEMINI_API_KEY,
		},
		body: JSON.stringify({
			contents: [{ parts: [{ text: prompt }] }],
			generationConfig: {
				responseMimeType: "application/json",
				responseSchema,
			},
		}),
	});
	if (!res.ok) {
		throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
	}
	const data = await res.json<GeminiResponse>();
	const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) {
		throw new Error("Gemini API returned an empty response");
	}
	return JSON.parse(text) as T;
}

export async function suggestTranslations(
	env: Env,
	ja: string,
): Promise<Suggestion[]> {
	const prompt = `あなたは日本人の英会話学習者を支援するコーチです。
学習者が英会話レッスン中に言いたかった日本語の文を渡します。
自然な英語の言い方を3案提案してください。

条件:
- 実際の会話でそのまま使える、自然でシンプルな表現にする
- 3案はニュアンスや丁寧さが異なるようにする(例: カジュアル / 標準 / フォーマル、あるいは別の言い回し)
- style には表現の方向性を短い日本語ラベルで入れる(例: "カジュアル", "標準", "フォーマル", "口語的")
- explanation には、その表現のニュアンスや使う場面の解説を日本語で1〜2文で書く

日本語の文:
${ja}`;

	const parsed = await generateJson<{ suggestions?: Suggestion[] }>(
		env,
		prompt,
		SUGGEST_SCHEMA,
	);
	if (!parsed.suggestions?.length) {
		throw new Error("Gemini API returned no suggestions");
	}
	return parsed.suggestions;
}
