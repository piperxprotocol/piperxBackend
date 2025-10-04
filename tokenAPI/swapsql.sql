WITH split_pairs AS (
  SELECT
    s.*,
    substr(s.pair, 1, instr(s.pair, '-') - 1) AS token0_id,
    substr(s.pair, instr(s.pair, '-') + 1) AS token1_id
  FROM swaps s
  WHERE s.timestamp > strftime('%s','now') - 48*3600
),
union_tokens AS (
  SELECT token0_id AS token_id, CAST(amount_usd AS REAL) AS usd FROM split_pairs
  UNION ALL
  SELECT token1_id AS token_id, CAST(amount_usd AS REAL) AS usd FROM split_pairs
)
SELECT
  token_id,
  SUM(usd) AS total_usd
FROM union_tokens
GROUP BY token_id
HAVING total_usd > 500
ORDER BY total_usd DESC;
