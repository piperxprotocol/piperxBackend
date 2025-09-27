-- tokens 元信息（可选，若需要服务端持久化）
CREATE TABLE IF NOT EXISTS tokens (
id TEXT PRIMARY KEY,
creator TEXT,
name TEXT NOT NULL,
symbol TEXT NOT NULL,
created_at INTEGER
);


-- 分钟快照：每分钟每 token 一行
CREATE TABLE IF NOT EXISTS token_minutes (
id TEXT NOT NULL,
symbol TEXT NOT NULL,
minute_ts INTEGER NOT NULL,
price_usd REAL NOT NULL,
PRIMARY KEY (id, minute_ts)
);


-- 查询索引
CREATE INDEX IF NOT EXISTS idx_token_minutes_symbol_ts
ON token_minutes(symbol, minute_ts);