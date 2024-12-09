-- initialize.sql

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255),
  points INTEGER DEFAULT 0,
  cheat_count INTEGER DEFAULT 0,
  is_banned BOOLEAN DEFAULT FALSE,
  last_a_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  a INTEGER DEFAULT 5000,
  b INTEGER DEFAULT 5000,
  dolum_hizi INTEGER DEFAULT 10, -- 10 saniye 
  tiklama_hakki INTEGER DEFAULT 1, -- Her tıklamada eklenen puan
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
  game_id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) REFERENCES users(user_id) ON DELETE CASCADE,
  game_type VARCHAR(50),
  points_earned INTEGER DEFAULT 0,
  claimed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cheats (
  cheat_id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) REFERENCES users(user_id) ON DELETE CASCADE,
  cheat_type VARCHAR(50),
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  warning_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS warnings (
  warning_id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) REFERENCES users(user_id) ON DELETE CASCADE,
  message TEXT,
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
