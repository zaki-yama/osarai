# 英会話の復習 PWA「osarai」を Cloudflare 無料枠 + Gemini 無料枠で作った

英会話レッスンの復習用の個人アプリを作った。レッスン中に「言えなかったこと」を日本語のままメモしておくと LLM が自然な英語表現を教えてくれて、それを間隔反復(SRS)で「日本語を見て英語を発話する」形式のテストにしてくれる、というアプリだ。**ランニングコストほぼゼロ(Cloudflare 無料枠 + Gemini API 無料枠)** で、LLM・音声認識・プッシュ通知という「サーバーが重くなりがちな機能」を全部載せているのがポイント。この記事ではその実現方法を紹介する。

- リポジトリ: [zaki-yama/osarai](https://github.com/zaki-yama/osarai)

## アプリの主要機能

- **センテンス登録**: レッスンで言えなかったことを日本語で入力すると、Gemini が英語例文を **3案 + ニュアンス解説付き**(カジュアル / 標準 / フォーマルなど)で提案。選んで編集して登録する
- **発話テスト**: 日本語文を見て英語で発話 → [Web Speech API](https://developer.mozilla.org/ja/docs/Web/API/SpeechRecognition) で音声認識 → 認識テキストを **Gemini が意味ベースで採点**(言い回しの違いは許容し、講評も返す)。結果は赤ペンの〇✕スタンプで表示
- **間隔反復(SRS)**: 正解すると出題間隔が伸び、間違えるとリセットされる簡略版 SM-2 でスケジューリング
- **復習リマインダー**: 毎朝 7 時、復習期限の文があるときだけ **Web Push 通知**が届く
- **おまけ**: 登録英文の読み上げ([SpeechSynthesis](https://developer.mozilla.org/ja/docs/Web/API/SpeechSynthesis)、無料)、学習統計(連続日数・正答率・日別チャート)
- **PWA**: ホーム画面に追加してアプリとして使う。iOS の Web Push 受信にはこれが必須

## 技術スタック

[Bonsai Lapse](https://github.com/zaki-yama-labs/bonsai-lapse) と同じ「Workers に全部乗せ」構成。今回はそこに LLM とプッシュ通知が加わった。

| レイヤ | 技術 | 補足 |
|---|---|---|
| フロントエンド | React 19 + TypeScript + Vite | SPA。ルーターなし(タブ切り替えのみ) |
| ホスティング / API | [Cloudflare Workers + Static Assets](https://developers.cloudflare.com/workers/static-assets/) | 静的アセット・API・cron を 1 つの Worker に集約 |
| API フレームワーク | [Hono](https://hono.dev/) | Workers ネイティブな軽量フレームワーク |
| 開発環境統合 | [@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/vite-plugin/) | 公式テンプレート [vite-react-template](https://github.com/cloudflare/templates/tree/main/vite-react-template) をベースにした |
| DB | [Cloudflare D1](https://developers.cloudflare.com/d1/) | SQLite ベース。センテンス・復習履歴・push 購読を保存 |
| LLM | [Gemini API](https://ai.google.dev/gemini-api/docs)(gemini-2.5-flash) | 例文生成と発話採点。無料枠で運用 |
| 音声認識 / 読み上げ | [Web Speech API](https://developer.mozilla.org/ja/docs/Web/API/Web_Speech_API) | ブラウザ標準・無料。サーバーに音声を送らない |
| プッシュ通知 | Web Push + [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | 送信は [@block65/webcrypto-web-push](https://github.com/block65/webcrypto-web-push) |
| 認証 | [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) | アプリのコード 0 行で Google ログインを強制 |

設定は [`wrangler.json`](../wrangler.json) に集約されている。cron と D1 と環境変数がこれだけで宣言できる:

```jsonc
{
  "main": "./src/worker/index.ts",
  "assets": { "directory": "./dist/client", "not_found_handling": "single-page-application" },
  "triggers": { "crons": ["0 0 * * *"] },  // 毎朝 9:00 JST
  "d1_databases": [{ "binding": "DB", "database_name": "osarai", ... }],
  "vars": { "GEMINI_MODEL": "gemini-2.5-flash", "VAPID_PUBLIC_KEY": "..." }
}
```

## コアとなる技術部分の解説

### 1. LLM に「意味で」採点させる — Structured Output × 簡略 SM-2

このアプリの核。Anki のような従来の SRS アプリでは答え合わせが「自己申告」か「文字列一致」になるが、スピーキング練習では **お手本と一言一句同じである必要はない**。そこで採点を LLM に任せた。

音声認識したテキストとお手本を Gemini に渡し、[Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)(`responseSchema`)で `{ correct: boolean, comment: string }` を返させる([`src/worker/gemini.ts`](../src/worker/gemini.ts)):

```ts
const JUDGE_SCHEMA = {
  type: "OBJECT",
  properties: { correct: { type: "BOOLEAN" }, comment: { type: "STRING" } },
  required: ["correct", "comment"],
};
```

プロンプトには採点基準を明示している。ここが体験の質を決める:

```
- お手本と一言一句同じである必要はない。日本語の意味が英語として自然に伝わっていれば正解
- 音声認識による軽微な誤変換(大文字小文字・句読点・同音異義語)は減点しない
- 意味が変わってしまう文法ミス、主要な語彙の欠落、意味の通らない文は不正解
```

実際、お手本が "…I can hardly find time to **exercise**" のところを "…I do not have much time to **work out**" と答えても正解にしてくれて、講評で「hardly を使うともっと良い」と教えてくれる。

採点が正解/不正解の 2 値なので、SRS アルゴリズムは [SM-2](https://en.wikipedia.org/wiki/SuperMemo#Description_of_SM-2_algorithm) を 2 値用に簡略化した([`src/worker/srs.ts`](../src/worker/srs.ts))。正解なら `間隔 × ease` で伸ばし、不正解なら ease を下げて**その日のうちに再出題**(Anki の再学習と同じ発想):

```ts
if (!correct) {
  return { intervalDays: 1, ease: Math.max(1.3, ease - 0.2), streak: 0, dueInDays: 0 };
}
const intervalDays = streak === 0 ? 1 : round(interval_days * ease);
```

例文生成側([`suggestTranslations`](../src/worker/gemini.ts))も同じ Structured Output 方式で、3 案を「スタイルラベル + 日本語のニュアンス解説」付きの JSON で返させている。

### 2. Cloudflare Workers から Web Push を送る

「毎朝、復習期限の文があったらプッシュ通知」を実現したい。Web Push は次の 3 者で成り立つ:

```
osarai Worker ──(VAPID 署名 + 暗号化ペイロード)──> プッシュサービス(Apple / FCM) ──> 端末の Service Worker
```

サーバー側の定番ライブラリ [web-push](https://github.com/web-push-libs/web-push) は Node の `crypto` に依存していて **Workers では動かない**。代わりに WebCrypto ベースの [@block65/webcrypto-web-push](https://github.com/block65/webcrypto-web-push) を使うと、VAPID([RFC 8292](https://datatracker.ietf.org/doc/html/rfc8292))の JWT 署名とペイロード暗号化([RFC 8291](https://datatracker.ietf.org/doc/html/rfc8291) の aes128gcm)をやってくれる。送信は素の `fetch` だ([`src/worker/push.ts`](../src/worker/push.ts)):

```ts
const payload = await buildPushPayload(message, subscription, vapid);
const res = await fetch(subscription.endpoint, payload);
if (res.status === 404 || res.status === 410) {
  // 無効化された購読は削除
}
```

定時実行は [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。`wrangler.json` に cron 式を書いて、Worker に `scheduled()` をエクスポートするだけで、**常駐プロセスなしのサーバーレス cron** になる([`src/worker/index.ts`](../src/worker/index.ts)):

```ts
export default {
  fetch: app.fetch,
  scheduled: async (_controller, env) => {
    await sendReviewReminder(env); // due の文があれば全購読に送信
  },
} satisfies ExportedHandler<Env>;
```

iOS で受信するには **iOS 16.4 以上 + ホーム画面に追加した PWA** が条件([WebKit のアナウンス](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))。実機の iPhone で購読 → 受信 → 通知タップからの起動まで動作確認済み。ハマりどころを 2 つ:

- `wrangler dev --test-scheduled` は静的アセット付き Worker だと scheduled イベントがユーザー Worker に届かず、ローカルで cron を試せなかった。テスト送信用のエンドポイント(`POST /api/push/test`)を生やして実機で確認する方式にした
- 通知の中身はプッシュサービス(Apple)にも読めない設計(端末ごとの公開鍵で暗号化するため)。プライバシー面は仕組みとして担保されている

詳細は [docs/notifications.md](./notifications.md) にまとめた。

### 3. 音声入力も読み上げも「ブラウザ標準・無料・サーバー送信なし」

発話テストの音声認識は [SpeechRecognition](https://developer.mozilla.org/ja/docs/Web/API/SpeechRecognition)(Web Speech API)を使う。Whisper のような音声認識 API をサーバーで叩く構成に比べて、**無料・低遅延・音声データが端末の外に出ない**(認識テキストだけを採点 API に送る)。

```ts
const rec = new (window.SpeechRecognition ?? window.webkitSpeechRecognition)();
rec.lang = "en-US";
rec.interimResults = true;  // 話しながらリアルタイムに表示
rec.continuous = true;      // 話の区切りで止めない(停止はマイクの再タップ)
```

1つ罠があって、`continuous = true` にしても音声認識エンジンは長い無音で勝手に終了することがある(特に iOS)。「英語を考えながら話す」アプリでは考えている間に切られると致命的なので、ユーザーが明示的に停止するまでは `onend` でそれまでの認識テキストを引き継いで自動再開するようにした。認識結果はそのまま編集可能なテキストエリアに入れており、惜しい誤認識はキーボードで直してから採点に送れる。

TypeScript の `lib.dom` に SpeechRecognition の型が入っていないので、最小限の型定義を自前で書いている([`src/react-app/hooks/useSpeechRecognition.ts`](../src/react-app/hooks/useSpeechRecognition.ts))。iOS Safari(ホーム画面 PWA 含む)で動くことを実機確認できたが、動かない環境向けにキーボード入力へのフォールバック UI も用意した。お手本の読み上げは [SpeechSynthesis](https://developer.mozilla.org/ja/docs/Web/API/SpeechSynthesis) で、これもブラウザ標準・無料。

### 番外: 認証はコードを書かずに Cloudflare Access

個人アプリとはいえ、放置すると URL を知られただけで Gemini API を叩かれ放題になる。[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) を使うと、Worker のダッシュボードで workers.dev URL を「Restricted」に切り替えるだけで、**アプリのコードを 1 行も変えずに**全リクエストの手前に Google ログイン(OAuth)を挟める。ポリシーで自分のメールアドレスだけを許可している。cron はそもそも HTTP を通らないので Access の影響を受けず、プッシュ配信も問題なく届く。

## コスト

すべて無料枠に収まっていて、**月額 0 円**で運用している。

| サービス | 無料枠(執筆時点) | osarai での使い方 |
|---|---|---|
| [Workers](https://developers.cloudflare.com/workers/platform/pricing/) | 10 万リクエスト/日、Cron Triggers 含む | 1 ユーザーの API + 静的配信なので余裕 |
| [D1](https://developers.cloudflare.com/d1/platform/pricing/) | ストレージ 5GB、読み取り 500 万行/日、書き込み 10 万行/日 | テキストのみで数 KB/文 |
| [Gemini API](https://ai.google.dev/gemini-api/docs/pricing) | 無料ティアあり(モデルごとに[レート制限](https://ai.google.dev/gemini-api/docs/rate-limits)) | 例文生成 + 採点で 1 日数十リクエスト程度。制限に達しても課金されず一時的に使えなくなるだけ |
| [Cloudflare Access](https://www.cloudflare.com/plans/zero-trust-services/) | Zero Trust Free プラン(50 ユーザーまで) | 1 ユーザー |
| Web Speech API / Web Push | ブラウザ標準機能なので無料 | — |

LLM を使うアプリは「API 課金が怖い」となりがちだが、**個人利用の頻度なら Gemini の無料ティアで十分**というのが今回の学び。仮に有料モデルに切り替えても、gemini-2.5-flash クラスなら 1 リクエストあたり小数点以下の円で済む規模だ。

## 参考リンク

- [zaki-yama/osarai](https://github.com/zaki-yama/osarai) — 本アプリのリポジトリ
- [Gemini API: Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Cloudflare Workers: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [RFC 8292: VAPID](https://datatracker.ietf.org/doc/html/rfc8292) / [RFC 8291: Message Encryption for Web Push](https://datatracker.ietf.org/doc/html/rfc8291)
- [@block65/webcrypto-web-push](https://github.com/block65/webcrypto-web-push)
- [MDN: Web Speech API](https://developer.mozilla.org/ja/docs/Web/API/Web_Speech_API)
- [SuperMemo SM-2 アルゴリズム](https://en.wikipedia.org/wiki/SuperMemo#Description_of_SM-2_algorithm)
