# リマインダー通知の仕様と仕組み

osarai のプッシュ通知(復習リマインダー)の仕様と、Web Push を Cloudflare Workers 上で実現している仕組みのドキュメント。

## 1. 仕様

| 項目 | 内容 |
|---|---|
| 送信タイミング | 毎朝 **9:00 JST**(Cron Trigger `0 0 * * *` = 0:00 UTC) |
| 送信条件 | 復習期限が来た文(`due_at <= now`)が **1件以上あるときだけ** 送信。0件の日は送らない |
| 通知内容 | 「今日のおさらいが N 文あります」(タイトルは osarai) |
| タップ時の挙動 | アプリを開く(既に開いているウィンドウがあればフォーカス) |
| 購読のオン/オフ | アプリヘッダーの**ベルアイコン**で切り替え。オンにすると購読情報が D1 に保存される |
| 対応環境 | iOS は **16.4 以上**かつ**ホーム画面に追加した PWA のみ**受信可(Safari ブラウザ版では不可)。Android/デスクトップ Chrome はブラウザでも可 |
| テスト送信 | `POST /api/push/test` で即時にテスト通知を送れる(Cloudflare Access の認証が必要) |
| 購読の掃除 | プッシュサービスが 404/410 を返した購読(無効化済み)は送信時に自動削除 |

## 2. 全体像

登場人物は「ブラウザ(PWA + Service Worker)」「osarai Worker」「プッシュサービス(Apple / FCM などブラウザベンダーのサーバー)」の3つ。

### 購読登録フロー(初回にベルをタップしたとき)

```
ユーザー ─タップ→ NotificationBell (App.tsx)
  1. Notification.requestPermission()               … OS の許可ダイアログ
  2. registration.pushManager.subscribe()            … VAPID 公開鍵を渡して購読を作成
       └ ブラウザがプッシュサービスに購読を発行させる(endpoint URL + 暗号化用の鍵ペア)
  3. POST /api/push/subscribe                        … 購読 JSON を D1 に保存
```

### 配信フロー(毎朝)

```
Cron Trigger (0:00 UTC)
  → Worker の scheduled() ハンドラ
  → sendReviewReminder(): due_at <= now の件数を D1 で数える(0 なら終了)
  → sendPushToAll(): 購読ごとに
       1. VAPID 秘密鍵で JWT に署名(送信者の証明)
       2. ペイロードを暗号化(aes128gcm)
       3. 購読の endpoint(Apple/FCM の URL)へ POST
  → プッシュサービスが端末に配信
  → 端末の Service Worker で 'push' イベント → showNotification()
  → タップで 'notificationclick' → アプリをフォーカス or 新規に開く
```

## 3. 構成要素と実装ファイル

| 役割 | ファイル | 概要 |
|---|---|---|
| Service Worker | [`public/sw.js`](../public/sw.js) | `push` イベントで通知表示、`notificationclick` でアプリを開く |
| 購読 UI | [`src/react-app/App.tsx`](../src/react-app/App.tsx) | `NotificationBell` コンポーネント(状態: unsupported / off / on / busy) |
| 購読ヘルパー | [`src/react-app/push.ts`](../src/react-app/push.ts) | SW 登録、購読作成・解除、VAPID 公開鍵の base64url → Uint8Array 変換 |
| 購読 API | [`src/worker/index.ts`](../src/worker/index.ts) | `GET /api/push/public-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test` |
| 送信ロジック | [`src/worker/push.ts`](../src/worker/push.ts) | `sendPushToAll()` / `sendReviewReminder()`。暗号化と VAPID 署名は `@block65/webcrypto-web-push` |
| スケジュール | [`wrangler.json`](../wrangler.json) | `triggers.crons: ["0 0 * * *"]` と Worker の `scheduled()` エクスポート |
| 購読の保存先 | D1 `push_subscriptions` テーブル | 購読 JSON(endpoint と鍵)をそのまま TEXT で保存 |

## 4. VAPID と鍵の管理

VAPID(RFC 8292)は「この通知を送っているサーバーは誰か」をプッシュサービスに証明する公開鍵認証の仕組み。

- **公開鍵**: `wrangler.json` の `vars.VAPID_PUBLIC_KEY`(コミットされる。ブラウザにも渡すので公開で問題ない)
- **秘密鍵**: 本番は Worker シークレット(`wrangler secret put VAPID_PRIVATE_KEY`)、ローカルは `.dev.vars`(gitignore 済み)
- 鍵ペアは `npx web-push generate-vapid-keys` で生成した

**鍵をローテーションする場合**: 新しい鍵ペアを生成 → 公開鍵とシークレットを入れ替えてデプロイ → 既存の購読は古い公開鍵に紐付いているため無効になる → 各端末でベルをオフ→オンして再購読する。

## 5. Web Push プロトコルの要点

- 通知はアプリのサーバーから端末へ直接届くのではなく、必ず**ブラウザベンダーのプッシュサービス**(iOS Safari なら Apple、Chrome なら FCM)を経由する。購読の `endpoint` がそのサービスの URL
- ペイロードは RFC 8291 の **aes128gcm** で、購読ごとの端末公開鍵(`p256dh`)と認証シークレット(`auth`)に対して暗号化する。**プッシュサービスは通知の中身を読めない**
- 定番の npm パッケージ `web-push` は Node の `crypto` に依存しており **Workers では動かない**。osarai では WebCrypto ベースの [`@block65/webcrypto-web-push`](https://github.com/block65/webcrypto-web-push) を使用
- 送信リクエストには TTL(未達時の保持期間)と urgency を設定できる。リマインダーは `ttl: 12時間 / urgency: normal`、テスト送信は `ttl: 5分 / urgency: high`

## 6. 運用メモ

- **Cloudflare Access の影響なし**: Cron の scheduled イベントは HTTP を通らないため Access の対象外。配信もプッシュサービス経由なので届く。`POST /api/push/test` だけは Access の認証が必要
- **通知が届かないときのチェックリスト**
  1. D1 に購読があるか: `wrangler d1 execute osarai --remote --command "SELECT id, created_at FROM push_subscriptions"`
  2. テスト送信の結果: `/api/push/test` のレスポンスで各購読の HTTP ステータスを確認(201 = プッシュサービスが受理)
  3. Cron が動いたか: ダッシュボードの Worker → Settings → Trigger events → View events
  4. iOS 側: 設定 → 通知 → osarai が許可されているか。PWA を再インストールした場合は再購読が必要
