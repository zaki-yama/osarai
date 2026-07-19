import { api, speak } from "../api";
import { MASTERY_STREAK } from "../../shared/srs";
import type { Sentence } from "../../shared/types";

function formatDate(sqlite: string) {
	// D1 stores UTC "YYYY-MM-DD HH:MM:SS"
	const date = new Date(`${sqlite.replace(" ", "T")}Z`);
	return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function ListScreen({
	sentences,
	loading,
	error,
	onDeleted,
}: {
	sentences: Sentence[];
	loading: boolean;
	error: string | null;
	onDeleted: () => void;
}) {
	const handleDelete = async (s: Sentence) => {
		if (!window.confirm(`「${s.en}」を削除しますか?`)) return;
		await api.deleteSentence(s.id);
		onDeleted();
	};

	return (
		<section className="screen">
			<h2 className="screen-title">
				<span className="title-accent">おぼえる文</span>の一覧
				{sentences.length > 0 && (
					<span className="count-badge">{sentences.length}</span>
				)}
			</h2>

			{loading && <p className="muted-note">読み込み中…</p>}
			{error && <p className="error-note">{error}</p>}
			{!loading && !error && sentences.length === 0 && (
				<div className="empty-state">
					<p>まだ何も登録されていません。</p>
					<p>「登録」タブから最初の一文を残しましょう。</p>
				</div>
			)}

			<ul className="sentence-list">
				{sentences.map((s) => (
					<li key={s.id} className="sentence-card">
						<p className="sentence-en">{s.en}</p>
						<p className="sentence-ja">{s.ja}</p>
						{s.note && <p className="sentence-note">{s.note}</p>}
						<div className="mastery-row">
							<div className="mastery-bar">
								<div
									className="mastery-bar-fill"
									style={{
										width: `${(Math.min(s.streak, MASTERY_STREAK) / MASTERY_STREAK) * 100}%`,
									}}
								/>
							</div>
							<span className="mastery-label">
								{Math.round(
									(Math.min(s.streak, MASTERY_STREAK) / MASTERY_STREAK) * 100,
								)}
								%・復習{s.review_count}回
							</span>
						</div>
						<div className="sentence-footer">
							<span className="sentence-date">{formatDate(s.created_at)} 登録</span>
							<span className="sentence-actions">
								<button
									type="button"
									className="icon-btn"
									onClick={() => speak(s.en)}
									aria-label="読み上げ"
								>
									<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
										<path
											d="M4 9v6h4l5 4V5L8 9H4z"
											fill="currentColor"
										/>
										<path
											d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.8"
											strokeLinecap="round"
										/>
									</svg>
								</button>
								<button
									type="button"
									className="icon-btn icon-btn-danger"
									onClick={() => handleDelete(s)}
									aria-label="削除"
								>
									<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
										<path
											d="M5 7h14M10 7V5h4v2m-6.5 0 .7 12h7.6l.7-12"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.8"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</button>
							</span>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}
