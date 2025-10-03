CREATE TABLE swaps (
  id INTEGER PRIMARY KEY,        -- 链上事件唯一标识 (去重用)
  vid INTEGER NOT NULL,          -- Subgraph 序号
  timestamp TEXT NOT NULL,       -- ISO8601 格式
  pair TEXT NOT NULL,            -- 交易对地址
  token_0_amount TEXT NOT NULL,  -- token0 数量
  token_1_amount TEXT NOT NULL,  -- token1 数量
  account TEXT NOT NULL,         -- 交易发起账户
  amount_usd TEXT,               -- 折合 USD
  amount_native TEXT             -- 折合 Native
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,   -- token 地址
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INT NOT NULL
);

CREATE TABLE prices (
  token_id TEXT NOT NULL,
  hour_bucket INTEGER NOT NULL, -- 小时桶
  ts INTEGER NOT NULL,          -- 实际时间戳（最后一次的）
  price_usd REAL NOT NULL,
  PRIMARY KEY (token_id, hour_bucket)
);