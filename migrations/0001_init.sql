-- Registered sentences with SRS state
CREATE TABLE sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ja TEXT NOT NULL,
  en TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  interval_days REAL NOT NULL DEFAULT 1,
  ease REAL NOT NULL DEFAULT 2.5,
  due_at TEXT NOT NULL,
  streak INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sentences_due_at ON sentences (due_at);

-- Review history
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  correct INTEGER NOT NULL,
  spoken_text TEXT,
  judge_comment TEXT
);

CREATE INDEX idx_reviews_sentence_id ON reviews (sentence_id);

-- Web Push subscriptions
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
