import type { JudgeResult, Suggestion } from "../shared/types";

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

const JUDGE_SCHEMA = {
	type: "OBJECT",
	properties: {
		correct: { type: "BOOLEAN" },
		comment: { type: "STRING" },
	},
	required: ["correct", "comment"],
};

export async function judgeAnswer(
	env: Env,
	sentence: { ja: string; en: string },
	answer: string,
): Promise<JudgeResult> {
	const prompt = `あなたは日本人の英会話学習者の発話を採点するコーチです。
学習者は次の日本語の意味を英語で言う練習をしています。

日本語: ${sentence.ja}
お手本の英文: ${sentence.en}

学習者の発話(音声認識で文字起こししたもの):
${answer}

採点基準:
- お手本と一言一句同じである必要はない。日本語の意味が英語として自然に伝わっていれば正解(correct=true)
- 音声認識による軽微な誤変換(大文字小文字・句読点・同音異義語)は減点しない
- 意味が変わってしまう文法ミス、主要な語彙の欠落、意味の通らない文は不正解(correct=false)
- comment には採点理由と、より良い言い方のアドバイスを日本語で1〜2文で書く`;

	return generateJson<JudgeResult>(env, prompt, JUDGE_SCHEMA);
}
