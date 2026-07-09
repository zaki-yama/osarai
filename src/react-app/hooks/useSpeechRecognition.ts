import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal Web Speech API typings — SpeechRecognition is not in lib.dom */
interface RecognitionEventLike {
	results: {
		length: number;
		[index: number]: { 0: { transcript: string } };
	};
}

interface RecognitionLike {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	start(): void;
	stop(): void;
	abort(): void;
	onresult: ((e: RecognitionEventLike) => void) | null;
	onend: (() => void) | null;
	onerror: ((e: { error: string }) => void) | null;
}

declare global {
	interface Window {
		SpeechRecognition?: new () => RecognitionLike;
		webkitSpeechRecognition?: new () => RecognitionLike;
	}
}

const ERROR_MESSAGES: Record<string, string> = {
	"not-allowed": "マイクの使用が許可されていません",
	"audio-capture": "マイクが見つかりません",
	network: "音声認識サービスに接続できませんでした",
	"no-speech": "音声を聞き取れませんでした。もう一度お試しください",
};

/* Errors that end the session for good — don't auto-restart after these */
const FATAL_ERRORS = new Set(["not-allowed", "audio-capture", "network"]);

export function useSpeechRecognition(lang: string) {
	const Ctor =
		typeof window !== "undefined"
			? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
			: undefined;
	const supported = Boolean(Ctor);
	const recRef = useRef<RecognitionLike | null>(null);
	// true while the user hasn't tapped stop — onend restarts recognition
	const keepListeningRef = useRef(false);
	// text finalized in previous recognition sessions (survives auto-restarts)
	const carriedRef = useRef("");
	// text from the current recognition session
	const sessionRef = useRef("");
	const [listening, setListening] = useState(false);
	const [transcript, setTranscript] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		return () => {
			keepListeningRef.current = false;
			recRef.current?.abort();
		};
	}, []);

	const start = useCallback(() => {
		if (!Ctor) return;
		keepListeningRef.current = false;
		recRef.current?.abort();
		carriedRef.current = "";
		sessionRef.current = "";
		setTranscript("");
		setError(null);
		keepListeningRef.current = true;

		const begin = () => {
			const rec = new Ctor();
			recRef.current = rec;
			rec.lang = lang;
			rec.interimResults = true;
			rec.continuous = true;
			rec.onresult = (e) => {
				let text = "";
				for (let i = 0; i < e.results.length; i++) {
					text += e.results[i][0].transcript;
				}
				sessionRef.current = text;
				setTranscript([carriedRef.current, text].filter(Boolean).join(" "));
			};
			rec.onerror = (e) => {
				// no-speech just means a long pause — keep waiting for the user
				if (e.error === "no-speech" || e.error === "aborted") return;
				setError(ERROR_MESSAGES[e.error] ?? `音声認識エラー (${e.error})`);
				if (FATAL_ERRORS.has(e.error)) keepListeningRef.current = false;
			};
			rec.onend = () => {
				if (sessionRef.current) {
					carriedRef.current = [carriedRef.current, sessionRef.current]
						.filter(Boolean)
						.join(" ");
					sessionRef.current = "";
				}
				if (keepListeningRef.current) {
					// engine gave up (e.g. iOS after silence) — resume until tapped
					try {
						begin();
						return;
					} catch {
						keepListeningRef.current = false;
					}
				}
				setListening(false);
			};
			rec.start();
		};

		begin();
		setListening(true);
	}, [Ctor, lang]);

	const stop = useCallback(() => {
		keepListeningRef.current = false;
		recRef.current?.stop();
	}, []);

	const reset = useCallback(() => {
		keepListeningRef.current = false;
		recRef.current?.abort();
		carriedRef.current = "";
		sessionRef.current = "";
		setTranscript("");
		setError(null);
		setListening(false);
	}, []);

	return { supported, listening, transcript, error, start, stop, reset };
}
