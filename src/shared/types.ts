export interface Suggestion {
	en: string;
	style: string;
	explanation: string;
}

export interface Sentence {
	id: number;
	ja: string;
	en: string;
	note: string | null;
	created_at: string;
	interval_days: number;
	ease: number;
	due_at: string;
	streak: number;
}
