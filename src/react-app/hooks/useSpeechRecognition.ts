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

export function useSpeechRecognition(lang: string) {
	const Ctor =
		typeof window !== "undefined"
			? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
			: undefined;
	const supported = Boolean(Ctor);
	const recRef = useRef<RecognitionLike | null>(null);
	const [listening, setListening] = useState(false);
	const [transcript, setTranscript] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		return () => recRef.current?.abort();
	}, []);

	const start = useCallback(() => {
		if (!Ctor) return;
		recRef.current?.abort();
		const rec = new Ctor();
		recRef.current = rec;
		rec.lang = lang;
		rec.interimResults = true;
		rec.continuous = false;
		setTranscript("");
		setError(null);
		rec.onresult = (e) => {
			let text = "";
			for (let i = 0; i < e.results.length; i++) {
				text += e.results[i][0].transcript;
			}
			setTranscript(text);
		};
		rec.onerror = (e) => {
			setError(ERROR_MESSAGES[e.error] ?? `音声認識エラー (${e.error})`);
		};
		rec.onend = () => setListening(false);
		rec.start();
		setListening(true);
	}, [Ctor, lang]);

	const stop = useCallback(() => {
		recRef.current?.stop();
	}, []);

	const reset = useCallback(() => {
		recRef.current?.abort();
		setTranscript("");
		setError(null);
		setListening(false);
	}, []);

	return { supported, listening, transcript, error, start, stop, reset };
}
