# osarai — 英会話復習アプリ 仕様書・実装計画

アプリ名: **osarai**(「おさらい」= 復習)

作成日: 2026-07-09

## 1. 概要

英会話レッスンの復習を支援する個人用Webアプリ(モバイルメイン)。

- レッスンで学んだ・言えなかったセンテンスを日本語で登録すると、LLMが適切な英語例文を提案する
- 登録した日英文をSRS(間隔反復)でテストし、記憶に定着させる

## 2. 機能要件

### 2.1 センテンス登録

- 日本語文をテキスト入力する(スマホキーボードの音声入力も利用可)
- LLMが英語例文を**複数案(2〜3案)+ニュアンス解説付き**で提示する
  - 例: カジュアル/フォーマルの使い分け、レッスンで習った表現との違いなど
- 提示された案を選択し、必要なら編集して登録する
- 登録時に自動でSRSの初期スケジュールが設定される

### 2.2 復習テスト

- **SRS(間隔反復)** で出題タイミングを管理する
  - 正解すると次回までの間隔が伸び、不正解だと短くなる
- テスト形式: **日本語文を見て英語を発話する**
  1. 日本語文が表示される
  2. アプリ内のマイクボタンで発話を音声認識(Web Speech API)。考えている間に切れないよう、**もう一度タップするまで聞き続ける**
  3. 認識テキストはキーボードで修正できる(惜しい誤認識を直してから採点に送れる)
  4. 認識テキストと登録英文をLLMが**意味ベースで正誤判定**(言い回しの違いは許容し、判定理由も返す)
  5. 判定結果に応じてSRSスケジュールを更新
- 音声認識が使えない環境ではキーボード入力(音声入力含む)にフォールバック

### 2.3 リマインダー

- 復習期限が来たセンテンスがある日は**プッシュ通知**を送る(1日1回、定時)
- PWAとしてホーム画面に追加して利用する(iOSのWeb Push受信に必須)

### 2.4 付加機能

- 登録英文の**音声読み上げ**(ブラウザのSpeechSynthesis API、無料)
- **学習統計**: 連続学習日数、登録文数、覚えた文数、正答率の推移

### 2.5 スコープ外(当面やらないこと)

- 複数ユーザー対応・一般公開
- レッスンメモの一括取り込み
- タグ・レッスン単位のグルーピング(必要になったら追加)

## 3. 非機能要件・前提

- 利用者は自分のみ(1ユーザー)
- 利用規模: 数文/レッスン、週数回程度 → データ量・API使用量ともに小さい
- 運用コストはほぼゼロを目指す(各サービスの無料枠内で運用)
- モバイル(スマホ)での利用が中心。PWAとしてホーム画面追加を前提とする

## 4. 技術スタック

Cloudflareに全面的に寄せる構成。

| レイヤー | 技術 | 備考 |
|---|---|---|
| フレームワーク | Hono + React SPA (Vite) | 1つのWorkerにAPI・Cron・静的配信を集約 |
| 実行環境 | Cloudflare Workers | 無料枠 |
| DB | Cloudflare D1 (SQLite) | 無料枠 |
| LLM | Gemini API 無料枠 | 例文生成・発話採点に使用 |
| 音声認識 | Web Speech API (SpeechRecognition) | iOS Safariで問題があればキーボード入力にフォールバック |
| 音声読み上げ | SpeechSynthesis API | ブラウザ標準・無料 |
| プッシュ通知 | Web Push (VAPID) + Workers Cron Triggers | 定時に期限チェックして配信 |
| 認証 | Cloudflare Access (Googleログイン) | アプリ側の認証コードほぼ不要、無料枠(〜50ユーザー) |
| PWA | manifest + Service Worker | ホーム画面追加、Push受信 |

### 選定理由メモ

- **Next.jsを使わない理由**: CloudflareではOpenNextという変換レイヤーが必要で相性が悪い。本アプリはSEO不要のクライアント中心アプリなのでSSR自体が不要
- **Hono + SPA**: API・Cron Trigger・静的アセット配信を1 Workerで完結でき、構成が最もシンプル。Hono RPCでフロントと型共有も可能
- **Gemini無料枠**: 個人利用の頻度ならレート制限内に収まる見込み。品質に不満が出たらClaude Haiku等への切り替えを検討

## 5. データモデル(案)

```sql
-- 登録センテンス
CREATE TABLE sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ja TEXT NOT NULL,             -- 日本語文
  en TEXT NOT NULL,             -- 登録した英文
  note TEXT,                    -- ニュアンス解説(LLM出力から保存)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- SRS状態
  interval_days REAL NOT NULL DEFAULT 1,   -- 次回までの間隔
  ease REAL NOT NULL DEFAULT 2.5,          -- 難易度係数
  due_at TEXT NOT NULL,                    -- 次回復習日時
  streak INTEGER NOT NULL DEFAULT 0        -- 連続正解数
);

-- 復習履歴
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id INTEGER NOT NULL REFERENCES sentences(id),
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  correct INTEGER NOT NULL,     -- 0/1
  spoken_text TEXT,             -- 音声認識されたテキスト
  judge_comment TEXT            -- LLMの判定コメント
);

-- Push購読情報
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription TEXT NOT NULL,   -- PushSubscriptionのJSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 6. SRSアルゴリズム(案)

LLM採点は正解/不正解の2値なので、SM-2を簡略化した2値版を使う。

- **正解**: `interval = interval * ease`(初回正解は1日→3日→…)、`streak += 1`
- **不正解**: `interval = 1日` にリセット、`ease = max(1.3, ease - 0.2)`、`streak = 0`
- `due_at = now + interval`

シンプルに始めて、使いながら調整する。

## 7. API設計(案)

| メソッド | パス | 内容 |
|---|---|---|
| POST | /api/suggest | 日本語文 → Geminiで英語例文を複数案生成 |
| POST | /api/sentences | センテンス登録 |
| GET | /api/sentences | 一覧取得 |
| DELETE | /api/sentences/:id | 削除 |
| GET | /api/review/queue | 復習期限が来たセンテンス一覧 |
| POST | /api/review/:id/judge | 発話テキストをGeminiで採点し、SRS状態を更新 |
| POST | /api/push/subscribe | Push購読登録 |
| GET | /api/stats | 学習統計 |
| (Cron) | 毎朝定時 | 期限到来のセンテンスがあればPush通知 |

## 8. 実装計画

### Phase 1: プロジェクトセットアップ

- Hono + Vite + React のスキャフォールド(Workers用テンプレート)
- D1のセットアップ、マイグレーション(スキーマ作成)
- ローカル開発環境(wrangler dev)とデプロイパイプラインの確認
- **完了条件**: Hello Worldがローカルと本番URLで動く

### Phase 2: センテンス登録(コア機能 1)

- Gemini API連携: 日本語文 → 複数案+解説を返す /api/suggest
- 登録UI: 入力 → 候補表示 → 選択・編集 → 保存
- 一覧・削除画面
- **完了条件**: スマホで日本語を入れて英文を登録できる

### Phase 3: 復習テスト(コア機能 2)

- SRSロジック(2値版SM-2)の実装
- 復習画面: 日本語表示 → マイクで発話 → 音声認識 → LLM採点 → 結果表示
- キーボード入力フォールバック
- 英文の読み上げボタン
- **完了条件**: 登録した文がスケジュール通りに出題され、発話で採点される
- **⚠️ このフェーズでiOS実機のWeb Speech API動作確認を行う**(最大のリスク要素)

### Phase 4: PWA化 + プッシュ通知

- manifest / Service Worker / ホーム画面追加対応
- Web Push購読フローとVAPID鍵の設定
- Cron Triggerで毎朝期限チェック → 通知送信
- **完了条件**: iPhoneのホーム画面から起動でき、復習期限の朝に通知が届く

### Phase 5: 仕上げ

- 学習統計画面
- Cloudflare Accessの設定(自分のGoogleアカウントのみ許可)
- モバイルUIの磨き込み

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| iOS Safari(PWAスタンドアロン)でWeb Speech APIが動かない | キーボード音声入力へのフォールバックUIを最初から用意。Phase 3で実機確認 |
| Gemini無料枠のレート制限・仕様変更 | 利用頻度が低いので当たりにくいが、LLM呼び出し部を抽象化して差し替え可能にしておく |
| iOSのWeb Push制約(ホーム画面追加必須など) | PWAインストールを前提とした導線にする。届かない場合は「アプリを開いたときに表示」で代替 |
