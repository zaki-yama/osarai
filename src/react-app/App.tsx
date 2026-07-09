import { useCallback, useEffect, useState } from "react";
import { api, parseSqliteDate } from "./api";
import {
	getSubscription,
	pushSupported,
	subscribePush,
	unsubscribePush,
} from "./push";
import { RegisterScreen } from "./screens/RegisterScreen";
import { ListScreen } from "./screens/ListScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import type { Sentence } from "../shared/types";

type Tab = "register" | "list" | "review";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
	{
		id: "register",
		label: "登録",
		icon: (
			<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
				<path
					d="m5 16 9.5-9.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinejoin="round"
				/>
			</svg>
		),
	},
	{
		id: "list",
		label: "一覧",
		icon: (
			<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
				<path
					d="M5 5h14v4H5zM5 11h14v4H5zM5 17h9"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		),
	},
	{
		id: "review",
		label: "おさらい",
		icon: (
			<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
				<circle
					cx="12"
					cy="12"
					r="8"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
				/>
				<path
					d="M12 8v4.5l3 2"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			</svg>
		),
	},
];

function NotificationBell() {
	const [state, setState] = useState<"unsupported" | "off" | "on" | "busy">(
		"unsupported",
	);

	useEffect(() => {
		if (!pushSupported()) return;
		void getSubscription().then((sub) => setState(sub ? "on" : "off"));
	}, []);

	if (state === "unsupported") return null;

	const toggle = async () => {
		const prev = state;
		setState("busy");
		try {
			if (prev === "on") {
				await unsubscribePush();
				setState("off");
			} else {
				await subscribePush();
				setState("on");
			}
		} catch (e) {
			alert(e instanceof Error ? e.message : "通知の設定に失敗しました");
			setState(prev);
		}
	};

	return (
		<button
			type="button"
			className={`bell-btn ${state === "on" ? "is-on" : ""}`}
			onClick={() => void toggle()}
			disabled={state === "busy"}
			aria-label={
				state === "on" ? "おさらい通知をオフにする" : "おさらい通知をオンにする"
			}
			title={state === "on" ? "通知オン" : "通知オフ"}
		>
			<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
				<path
					d="M12 3.5c-3 0-5 2.3-5 5.2 0 3.6-1 4.9-1.8 5.8-.3.4 0 1 .5 1h12.6c.5 0 .8-.6.5-1-.8-.9-1.8-2.2-1.8-5.8 0-2.9-2-5.2-5-5.2z"
					fill={state === "on" ? "currentColor" : "none"}
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinejoin="round"
				/>
				<path
					d="M10 18.5a2 2 0 0 0 4 0"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			</svg>
		</button>
	);
}

function App() {
	const [tab, setTab] = useState<Tab>("register");
	const [sentences, setSentences] = useState<Sentence[]>([]);
	const [listLoading, setListLoading] = useState(true);
	const [listError, setListError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setListError(null);
		try {
			const { sentences } = await api.listSentences();
			setSentences(sentences);
		} catch (e) {
			setListError(e instanceof Error ? e.message : "一覧の取得に失敗しました");
		} finally {
			setListLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const now = new Date();
	const dueCount = sentences.filter(
		(s) => parseSqliteDate(s.due_at) <= now,
	).length;

	return (
		<div className="app">
			<header className="app-header">
				<span className="hanko" aria-hidden="true">
					復
				</span>
				<h1 className="app-title">osarai</h1>
				<NotificationBell />
			</header>

			<main className="app-main">
				{tab === "register" && (
					<RegisterScreen onSaved={() => void refresh()} />
				)}
				{tab === "list" && (
					<ListScreen
						sentences={sentences}
						loading={listLoading}
						error={listError}
						onDeleted={() => void refresh()}
					/>
				)}
				{tab === "review" && <ReviewScreen onReviewed={() => void refresh()} />}
			</main>

			<nav className="tab-bar">
				{TABS.map((t) => (
					<button
						type="button"
						key={t.id}
						className={`tab-item ${tab === t.id ? "is-active" : ""}`}
						onClick={() => setTab(t.id)}
					>
						{t.icon}
						<span>{t.label}</span>
						{t.id === "review" && dueCount > 0 && (
							<span className="due-badge">{dueCount}</span>
						)}
					</button>
				))}
			</nav>
		</div>
	);
}

export default App;
