import { useCallback, useEffect, useState } from "react";
import { api, speak } from "../api";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import type { JudgeResult, Sentence } from "../../shared/types";

type Phase = "loading" | "empty" | "prompt" | "judging" | "result" | "summary";

export function ReviewScreen({ onReviewed }: { onReviewed: () => void }) {
	const [queue, setQueue] = useState<Sentence[]>([]);
	const [index, setIndex] = useState(0);
	const [phase, setPhase] = useState<Phase>("loading");
	const [typed, setTyped] = useState("");
	const [useKeyboard, setUseKeyboard] = useState(false);
	const [result, setResult] = useState<JudgeResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [correctCount, setCorrectCount] = useState(0);
	const speech = useSpeechRecognition("en-US");

	const loadQueue = useCallback(async () => {
		setPhase("loading");
		setError(null);
		try {
			const { sentences } = await api.reviewQueue();
			setQueue(sentences);
			setIndex(0);
			setCorrectCount(0);
			setPhase(sentences.length === 0 ? "empty" : "prompt");
		} catch (e) {
			setError(e instanceof Error ? e.message : "読み込みに失敗しました");
			setPhase("empty");
		}
	}, []);

	useEffect(() => {
		void loadQueue();
	}, [loadQueue]);

	const current: Sentence | undefined = queue[index];
	const answer = useKeyboard ? typed : speech.transcript;

	const handleJudge = async () => {
		if (!current || !answer.trim()) return;
		setPhase("judging");
		setError(null);
		try {
			const res = await api.judge(current.id, answer);
			setResult(res);
			if (res.correct) setCorrectCount((n) => n + 1);
			setPhase("result");
			onReviewed();
		} catch (e) {
			setError(e instanceof Error ? e.message : "採点に失敗しました");
			setPhase("prompt");
		}
	};

	const handleNext = () => {
		setResult(null);
		setTyped("");
		speech.reset();
		if (index + 1 < queue.length) {
			setIndex(index + 1);
			setPhase("prompt");
		} else {
			setPhase("summary");
		}
	};

	if (phase === "loading") {
		return (
			<section className="screen">
				<p className="muted-note">読み込み中…</p>
			</section>
		);
	}

	if (phase === "empty") {
		return (
			<section className="screen">
				<h2 className="screen-title">
					<span className="title-accent">おさらい</span>する
				</h2>
				{error ? (
					<p className="error-note">{error}</p>
				) : (
					<div className="empty-state">
						<p>今日のおさらいはありません 🎉</p>
						<p>新しい文を登録するか、また明日どうぞ。</p>
					</div>
				)}
			</section>
		);
	}

	if (phase === "summary") {
		return (
			<section className="screen">
				<h2 className="screen-title">
					<span className="title-accent">おさらい</span>おわり!
				</h2>
				<div className="summary-box">
					<p className="summary-score">
						<strong>{correctCount}</strong> / {queue.length} 正解
					</p>
					<p className="muted-note">
						{correctCount === queue.length
							? "全問正解です。この調子!"
							: "間違えた文は今日のうちにもう一度出題されます。"}
					</p>
					<button
						type="button"
						className="btn btn-primary"
						onClick={() => void loadQueue()}
					>
						続きをおさらいする
					</button>
				</div>
			</section>
		);
	}

	if (!current) return null;

	return (
		<section className="screen">
			<p className="review-progress">
				{index + 1} / {queue.length}
			</p>

			<div className="review-card">
				<p className="review-lead">これ、英語で言うと?</p>
				<p className="review-ja">{current.ja}</p>
			</div>

			{phase === "result" && result ? (
				<div className={`result-box ${result.correct ? "is-correct" : "is-wrong"}`}>
					<div className="result-stamp" aria-hidden="true">
						{result.correct ? (
							<svg viewBox="0 0 64 64" width="56" height="56">
								<circle
									cx="32"
									cy="32"
									r="24"
									fill="none"
									stroke="currentColor"
									strokeWidth="5"
								/>
							</svg>
						) : (
							<svg viewBox="0 0 64 64" width="56" height="56">
								<path
									d="M14 14l36 36M50 14L14 50"
									fill="none"
									stroke="currentColor"
									strokeWidth="5"
									strokeLinecap="round"
								/>
							</svg>
						)}
					</div>
					<p className="result-label">
						{result.correct ? "よくできました" : "おしい!"}
					</p>
					<div className="result-detail">
						<p className="field-label">あなたの答え</p>
						<p className="result-answer">{answer}</p>
						<p className="field-label">お手本</p>
						<p className="result-model">
							{current.en}
							<button
								type="button"
								className="icon-btn"
								onClick={() => speak(current.en)}
								aria-label="読み上げ"
							>
								<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
									<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
									<path
										d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
									/>
								</svg>
							</button>
						</p>
						<p className="result-comment">{result.comment}</p>
					</div>
					<button type="button" className="btn btn-primary" onClick={handleNext}>
						{index + 1 < queue.length ? "次へ" : "結果を見る"}
					</button>
				</div>
			) : (
				<div className="answer-area">
					{useKeyboard ? (
						<textarea
							id="answer-input"
							name="answer"
							className="en-input"
							value={typed}
							onChange={(e) => setTyped(e.target.value)}
							placeholder="英語で入力してください"
							rows={2}
						/>
					) : (
						<>
							<button
								type="button"
								className={`mic-btn ${speech.listening ? "is-listening" : ""}`}
								onClick={() =>
									speech.listening ? speech.stop() : speech.start()
								}
								disabled={!speech.supported || phase === "judging"}
								aria-label={speech.listening ? "録音を止める" : "話す"}
							>
								<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
									<rect
										x="9"
										y="3.5"
										width="6"
										height="11"
										rx="3"
										fill="currentColor"
									/>
									<path
										d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
									/>
								</svg>
							</button>
							<p className="mic-hint">
								{speech.listening
									? "聞いています… もう一度タップで停止"
									: "タップして英語で話してください"}
							</p>
							{speech.transcript && (
								<p className="transcript">{speech.transcript}</p>
							)}
							{speech.error && <p className="error-note">{speech.error}</p>}
							{!speech.supported && (
								<p className="error-note">
									このブラウザは音声認識に対応していません。キーボードで入力してください。
								</p>
							)}
						</>
					)}

					{error && <p className="error-note">{error}</p>}

					<button
						type="button"
						className="btn btn-accent"
						onClick={handleJudge}
						disabled={!answer.trim() || phase === "judging" || speech.listening}
					>
						{phase === "judging" ? "先生が採点中…" : "答え合わせ"}
					</button>

					<button
						type="button"
						className="link-btn"
						onClick={() => {
							setUseKeyboard(!useKeyboard);
							speech.reset();
							setTyped("");
						}}
					>
						{useKeyboard ? "マイクで話す" : "キーボードで入力する"}
					</button>
				</div>
			)}
		</section>
	);
}
