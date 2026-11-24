CREATE TABLE IF NOT EXISTS pessoas (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT, papel TEXT NOT NULL,
  cod_hash TEXT NOT NULL, token_hash TEXT UNIQUE, criado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pedidos (
  numero INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  etapa TEXT NOT NULL, urgente INTEGER NOT NULL DEFAULT 0, duplicado INTEGER NOT NULL DEFAULT 0,
  morador TEXT NOT NULL, telefone TEXT, bairro TEXT NOT NULL, endereco TEXT NOT NULL,
  lat REAL, lng REAL, obs TEXT, medidas TEXT, retirar_em TEXT,
  criado_por TEXT NOT NULL, criado_em INTEGER NOT NULL,
  dono TEXT, dono_desde INTEGER, dono_ate INTEGER, ultima_op TEXT
);
CREATE INDEX IF NOT EXISTS pedidos_etapa ON pedidos(etapa);
CREATE TABLE IF NOT EXISTS eventos (
  op_id TEXT PRIMARY KEY, pedido TEXT NOT NULL, pessoa TEXT NOT NULL, acao TEXT NOT NULL,
  etapa TEXT NOT NULL, obs TEXT, em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS eventos_pedido ON eventos(pedido);
CREATE TABLE IF NOT EXISTS fotos (
  id TEXT PRIMARY KEY, pedido TEXT NOT NULL, etapa TEXT NOT NULL, jpeg64 TEXT NOT NULL, em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fotos_pedido ON fotos(pedido);
CREATE TABLE IF NOT EXISTS tentativas (ip TEXT NOT NULL, em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tentativas_ip ON tentativas(ip, em);
