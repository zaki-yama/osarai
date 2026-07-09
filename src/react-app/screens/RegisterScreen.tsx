import { useState } from "react";
import { api } from "../api";
import type { Suggestion } from "../../shared/types";

type Choice = { suggestion: Suggestion | null; en: string; note: string };

export function RegisterScreen({ onSaved }: { onSaved: () => void }) {
	const [ja, setJa] = useState("");
	const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
	const [choice, setChoice] = useState<Choice | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [savedFlash, setSavedFlash] = useState(false);

	const reset = () => {
		setJa("");
		setSuggestions(null);
		setChoice(null);
		setError(null);
	};

	const handleSuggest = async () => {
		setLoading(true);
		setError(null);
		setSuggestions(null);
		setChoice(null);
		try {
			const { suggestions } = await api.suggest(ja);
			setSuggestions(suggestions);
		} catch (e) {
			setError(e instanceof Error ? e.message : "例文の生成に失敗しました");
		} finally {
			setLoading(false);
		}
	};

	const handleSave = async () => {
		if (!choice) return;
		setSaving(true);
		setError(null);
		try {
			await api.createSentence({
				ja,
				en: choice.en,
				note: choice.note || null,
			});
			reset();
			setSavedFlash(true);
			setTimeout(() => setSavedFlash(false), 2500);
			onSaved();
		} catch (e) {
			setError(e instanceof Error ? e.message : "登録に失敗しました");
		} finally {
			setSaving(false);
		}
	};

	return (
		<section className="screen">
			<h2 className="screen-title">
				<span className="title-accent">言いたかったこと</span>を残す
			</h2>

			<textarea
				id="ja-input"
				name="ja"
				className="ja-input"
				value={ja}
				onChange={(e) => setJa(e.target.value)}
				placeholder="レッスンで言えなかったことを、日本語のままどうぞ&#10;例: 最近仕事が忙しくて、なかなか運動する時間が取れない"
				rows={3}
				disabled={loading}
			/>

			<button
				type="button"
				className="btn btn-primary"
				onClick={handleSuggest}
				disabled={!ja.trim() || loading}
			>
				{loading ? "先生が考え中…" : "英語の言い方を教えてもらう"}
			</button>

			{error && <p className="error-note">{error}</p>}
			{savedFlash && <p className="saved-note">登録しました ✓</p>}

			{suggestions && (
				<div className="suggestions">
					<p className="suggestions-lead">タップして選んでください</p>
					{suggestions.map((s, i) => (
						<button
							type="button"
							key={i}
							className={`suggestion-card ${
								choice?.suggestion === s ? "is-selected" : ""
							}`}
							onClick={() =>
								setChoice({ suggestion: s, en: s.en, note: s.explanation })
							}
						>
							<span className="style-chip">{s.style}</span>
							<span className="suggestion-en">{s.en}</span>
							<span className="suggestion-explanation">{s.explanation}</span>
						</button>
					))}
					<button
						type="button"
						className={`suggestion-card suggestion-custom ${
							choice !== null && choice.suggestion === null ? "is-selected" : ""
						}`}
						onClick={() => setChoice({ suggestion: null, en: "", note: "" })}
					>
						<span className="suggestion-en">自分で英文を書く</span>
					</button>
				</div>
			)}

			{choice && (
				<div className="confirm-box">
					<label className="field-label" htmlFor="en-input">
						登録する英文(編集できます)
					</label>
					<textarea
						id="en-input"
						className="en-input"
						value={choice.en}
						onChange={(e) => setChoice({ ...choice, en: e.target.value })}
						rows={2}
					/>
					<button
						type="button"
						className="btn btn-accent"
						onClick={handleSave}
						disabled={!choice.en.trim() || saving}
					>
						{saving ? "登録中…" : "この文を登録する"}
					</button>
				</div>
			)}
		</section>
	);
}
