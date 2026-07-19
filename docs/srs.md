# SRS(間隔反復)の仕様と仕組み

osarai が「どの文をいつ復習させるか」を決めているロジックのドキュメント。

## 1. 各文が持つ SRS 状態

`sentences` テーブルの各行(1文)は、以下の状態を持つ。

| カラム | 意味 | 初期値 |
|---|---|---|
| `interval_days` | 次回までの間隔(日数) | `1` |
| `ease` | 間隔の伸びやすさ(易しさ係数) | `2.5` |
| `streak` | 連続正解数 | `0` |
| `due_at` | 次回の復習期限(この日時を過ぎたら出題対象) | 登録直後の現在時刻 |

登録した瞬間に `due_at` が「今」になるため、**新しく登録した文は次のおさらいで即座に出題される**。

## 2. 復習対象になる条件

「おさらい」画面(`ReviewScreen`)を開くと `GET /api/review/queue` を叩き、Worker 側は次のクエリで対象を取得する([`src/worker/index.ts`](../src/worker/index.ts)の `/api/review/queue`)。

```sql
SELECT * FROM sentences
WHERE due_at <= datetime('now')
ORDER BY due_at ASC, id ASC
```

条件はシンプルに **「`due_at` が現在時刻を過ぎている文すべて」**。日をまたいでいなくても、`due_at` を過ぎていれば同日中に何度でも出題対象になり得る(不正解時の即時リトライがこれにあたる、後述)。出題順は期限が早い(＝待たされている)文から。

## 3. 正解・不正解での更新ロジック

発話をLLMが判定した後、[`src/worker/srs.ts`](../src/worker/srs.ts) の `nextSrsState()` が次の状態を計算する。**LLM判定は正解/不正解の2値のみ**なので、SM-2アルゴリズムを2値用に簡略化したものを使っている。

### 正解した場合

```
interval_days = streak === 0 ? 1 : interval_days * ease   (四捨五入して小数第1位まで)
streak += 1
ease は変更しない
due_at = now + interval_days
```

- 初回正解(`streak === 0` から)は必ず **1日後**に設定される(いきなり長い間隔に飛ばさない)
- 2回目以降の正解は `間隔 × ease` で指数的に伸びていく。例: `ease = 2.5` なら 1日→2.5日→6.25日→…

### 不正解の場合

```
interval_days = 1
ease = max(1.3, ease - 0.2)   (下限 1.3)
streak = 0
due_at = now (dueInDays = 0)
```

- `due_at` が**現在時刻に戻る**ため、その文は即座に `due_at <= now` の条件を再び満たし、**同じセッション内でもう一度出題される**(「間違えた文は今日のうちにもう一度出題される」という仕様はこの仕組みによる)
- `ease` が下がる=次に正解しても間隔が伸びにくくなる。ただし `1.3` を下回らないよう下限がある(間隔が伸びなくなりすぎるのを防ぐ)
- `streak` は 0 にリセットされる

## 4. 「学習率(習熟度)」の定義

一覧画面(`ListScreen`)で文ごとに表示している学習率は、`streak` を「覚えた」とみなす基準値(`MASTERY_STREAK = 3`、[`src/shared/srs.ts`](../src/shared/srs.ts))に対する到達度で定義している。

```
学習率 = min(streak, MASTERY_STREAK) / MASTERY_STREAK
```

- `streak = 0` → 0%、`streak = 1` → 33%、`streak = 2` → 67%、`streak >= 3` → 100%
- 1回でも間違えると `streak` が 0 に戻るため、学習率も 0% に戻る。「今のところ連続で言えているか」を表す指標であり、過去の総正答率ではない
- 統計画面(`StatsScreen`)の「覚えた文数」も同じ `streak >= MASTERY_STREAK` を判定基準にしており、両画面で定義がずれないよう定数を共有している
- あわせて表示している「復習◯回」は `reviews` テーブルの件数(正誤を問わない実施回数の累計)で、`GET /api/sentences` が `LEFT JOIN reviews` で集計して返す `review_count`

## 5. 具体例

`ease = 2.5` を維持したまま連続正解し続けた場合の間隔の推移:

| 回数 | 結果 | interval_days | streak | 次回まで |
|---|---|---|---|---|
| 登録直後 | - | 1 | 0 | 今すぐ(即出題) |
| 1回目 | 正解 | 1 | 1 | 1日後 |
| 2回目 | 正解 | 2.5 | 2 | 2.5日後 |
| 3回目 | 正解 | 6.3 | 3 | 6.3日後(学習率100%到達) |
| 4回目 | 不正解 | 1 | 0 | 今すぐ(即再出題、学習率0%に戻る) |
| 5回目(同日リトライ) | 正解 | 1 | 1 | 1日後(easeは下がったまま) |

## 6. 関連ファイル

| 役割 | ファイル |
|---|---|
| SRS状態の更新ロジック | [`src/worker/srs.ts`](../src/worker/srs.ts) |
| 復習対象取得・判定APIの呼び出し元 | [`src/worker/index.ts`](../src/worker/index.ts)(`/api/review/queue`, `/api/review/:id/judge`) |
| 学習率のしきい値定数 | [`src/shared/srs.ts`](../src/shared/srs.ts) |
| 復習画面 | [`src/react-app/screens/ReviewScreen.tsx`](../src/react-app/screens/ReviewScreen.tsx) |
| 一覧画面(学習率・復習回数の表示) | [`src/react-app/screens/ListScreen.tsx`](../src/react-app/screens/ListScreen.tsx) |
| 統計画面(覚えた文数など) | [`src/react-app/screens/StatsScreen.tsx`](../src/react-app/screens/StatsScreen.tsx) |
