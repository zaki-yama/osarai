import type { Sentence } from "../../shared/types";

export function ReviewScreen({ sentences }: { sentences: Sentence[] }) {
	const now = new Date();
	const dueCount = sentences.filter(
		(s) => new Date(`${s.due_at.replace(" ", "T")}Z`) <= now,
	).length;

	return (
		<section className="screen">
			<h2 className="screen-title">
				<span className="title-accent">おさらい</span>する
			</h2>
			<div className="empty-state">
				<p className="due-count">
					復習待ち <strong>{dueCount}</strong> 文
				</p>
				<p>発話テストは準備中です。もうすこしお待ちください。</p>
			</div>
		</section>
	);
}
