CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS game (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
, player_a TEXT NOT NULL
, player_b TEXT
, grid_a JSON NOT NULL
, grid_b JSON NOT NULL
, player_turn TEXT
, player_victor TEXT
);

CREATE TABLE IF NOT EXISTS websocket (
  conn_id TEXT PRIMARY KEY
, game_id UUID NOT NULL
, username TEXT NOT NULL
);
