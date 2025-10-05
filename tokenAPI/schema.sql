CREATE TABLE swaps (
  id TEXT PRIMARY KEY,           
  vid INTEGER NOT NULL,          
  timestamp INTEGER NOT NULL,    
  pair TEXT NOT NULL,            
  token_0_amount TEXT NOT NULL,  
  token_1_amount TEXT NOT NULL,  
  account TEXT NOT NULL,         
  amount_usd TEXT,               
  amount_native TEXT             
);


CREATE TABLE tokens (
  id TEXT PRIMARY KEY,   
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INT NOT NULL,
  created_at INTEGER    
);
CREATE TABLE prices (
  token_id TEXT NOT NULL,
  hour_bucket INTEGER NOT NULL, 
  ts INTEGER NOT NULL,          
  price_usd REAL NOT NULL,
  PRIMARY KEY (token_id, hour_bucket)
);