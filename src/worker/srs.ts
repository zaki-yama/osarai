interface SrsInput {
	interval_days: number;
	ease: number;
	streak: number;
}

export interface SrsState {
	intervalDays: number;
	ease: number;
	streak: number;
	/** Days until the next review. 0 keeps the card in today's queue. */
	dueInDays: number;
}

/**
 * Simplified binary SM-2: the LLM judge only yields correct/incorrect.
 * Incorrect answers stay in today's queue so they can be retried
 * within the same session; the interval restarts at 1 day.
 */
export function nextSrsState(s: SrsInput, correct: boolean): SrsState {
	if (!correct) {
		return {
			intervalDays: 1,
			ease: Math.max(1.3, Math.round((s.ease - 0.2) * 100) / 100),
			streak: 0,
			dueInDays: 0,
		};
	}
	const intervalDays =
		s.streak === 0 ? 1 : Math.round(s.interval_days * s.ease * 10) / 10;
	return {
		intervalDays,
		ease: s.ease,
		streak: s.streak + 1,
		dueInDays: intervalDays,
	};
}
