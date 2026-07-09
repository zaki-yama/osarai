import { useEffect, useState } from "react";
import { api } from "../api";
import type { Stats } from "../../shared/types";

const DAYS = 14;
const BAR_W = 16;
const GAP = 8;
const CHART_H = 96;
const TOP_PAD = 16; // room for the direct value label above the tallest bar
const LABEL_H = 18;
const SIDE_PAD = 10; // keep edge axis labels inside the viewBox
const CHART_W = DAYS * (BAR_W + GAP) - GAP;

/** Last N days in JST as "YYYY-MM-DD", oldest first. */
function lastDays(n: number): string[] {
	const out: string[] = [];
	const jst = new Date(Date.now() + 9 * 3600_000);
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(jst);
		d.setUTCDate(d.getUTCDate() - i);
		out.push(d.toISOString().slice(0, 10));
	}
	return out;
}

/** Bar with rounded top corners, anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
	const r = Math.min(4, w / 2, h);
	const bottom = y + h;
	return [
		`M${x} ${bottom}`,
		`V${y + r}`,
		`Q${x} ${y} ${x + r} ${y}`,
		`H${x + w - r}`,
		`Q${x + w} ${y} ${x + w} ${y + r}`,
		`V${bottom}`,
		"Z",
	].join(" ");
}

function ActivityChart({ daily }: { daily: Stats["daily"] }) {
	const [active, setActive] = useState<number | null>(null);
	const byDay = new Map(daily.map((d) => [d.day, d]));
	const days = lastDays(DAYS);
	const values = days.map((day) => byDay.get(day) ?? { day, total: 0, correct: 0 });
	const max = Math.max(...values.map((v) => v.total), 1);

	if (values.every((v) => v.total === 0)) {
		return (
			<p className="muted-note">この2週間のおさらい記録はまだありません。</p>
		);
	}

	const activeValue = active !== null ? values[active] : null;

	return (
		<div className="chart-wrap">
			{activeValue && (
				<p className="chart-tooltip" role="status">
					{formatDay(activeValue.day)} — {activeValue.total}回
					{activeValue.total > 0 && ` (正解 ${activeValue.correct})`}
				</p>
			)}
			<svg
				viewBox={`${-SIDE_PAD} 0 ${CHART_W + SIDE_PAD * 2} ${CHART_H + LABEL_H}`}
				className="chart-svg"
				role="img"
				aria-label="直近14日間の日別おさらい回数"
			>
				{values.map((v, i) => {
					const x = i * (BAR_W + GAP);
					const h =
						v.total === 0
							? 0
							: Math.max((v.total / max) * (CHART_H - TOP_PAD), 4);
					const isToday = i === values.length - 1;
					return (
						<g
							key={v.day}
							onPointerEnter={() => setActive(i)}
							onPointerLeave={() => setActive(null)}
							onClick={() => setActive(active === i ? null : i)}
						>
							{/* hit target wider than the mark */}
							<rect
								x={x - GAP / 2}
								y={0}
								width={BAR_W + GAP}
								height={CHART_H}
								fill="transparent"
							/>
							{v.total > 0 && (
								<path
									d={barPath(x, CHART_H - h, BAR_W, h)}
									fill="var(--shu)"
									opacity={active === null || active === i ? 1 : 0.45}
								/>
							)}
							{isToday && v.total > 0 && (
								<text
									x={x + BAR_W / 2}
									y={CHART_H - h - 5}
									textAnchor="middle"
									className="chart-value-label"
								>
									{v.total}
								</text>
							)}
							{(i === 0 || i === values.length - 1 || i % 4 === 0) && (
								<text
									x={x + BAR_W / 2}
									y={CHART_H + 13}
									textAnchor="middle"
									className="chart-axis-label"
								>
									{formatDay(v.day)}
								</text>
							)}
						</g>
					);
				})}
				<line
					x1={0}
					y1={CHART_H}
					x2={CHART_W}
					y2={CHART_H}
					stroke="var(--line)"
					strokeWidth="1"
				/>
			</svg>
		</div>
	);
}

function formatDay(day: string): string {
	const [, m, d] = day.split("-");
	return `${Number(m)}/${Number(d)}`;
}

export function StatsScreen() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api
			.stats()
			.then(setStats)
			.catch((e) =>
				setError(e instanceof Error ? e.message : "読み込みに失敗しました"),
			);
	}, []);

	if (error) {
		return (
			<section className="screen">
				<p className="error-note">{error}</p>
			</section>
		);
	}
	if (!stats) {
		return (
			<section className="screen">
				<p className="muted-note">読み込み中…</p>
			</section>
		);
	}

	const accuracy =
		stats.reviews > 0 ? Math.round((stats.correct / stats.reviews) * 100) : null;

	return (
		<section className="screen">
			<h2 className="screen-title">
				<span className="title-accent">これまで</span>のきろく
			</h2>

			<div className="stats-grid">
				<div className="stat-tile">
					<p className="stat-value">
						{stats.studyStreak}
						<span className="stat-unit">日</span>
					</p>
					<p className="stat-caption">連続でおさらい</p>
				</div>
				<div className="stat-tile">
					<p className="stat-value">
						{stats.sentences}
						<span className="stat-unit">文</span>
					</p>
					<p className="stat-caption">登録した文</p>
				</div>
				<div className="stat-tile">
					<p className="stat-value">
						{stats.mastered}
						<span className="stat-unit">文</span>
					</p>
					<p className="stat-caption">おぼえた文 (3連続正解)</p>
				</div>
				<div className="stat-tile">
					<p className="stat-value">
						{accuracy === null ? "—" : accuracy}
						{accuracy !== null && <span className="stat-unit">%</span>}
					</p>
					<p className="stat-caption">正答率 (全期間)</p>
				</div>
			</div>

			<div className="chart-card">
				<h3 className="chart-title">日別のおさらい回数(直近14日)</h3>
				<ActivityChart daily={stats.daily} />
			</div>
		</section>
	);
}
