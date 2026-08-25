-- Esquema único: roda no SQLite local (node:sqlite) e no Cloudflare D1.

CREATE TABLE IF NOT EXISTS turmas (
  id           INTEGER PRIMARY KEY,
  nome         TEXT NOT NULL,
  periodo      TEXT,
  codigo       TEXT,
  professor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  meta_horas   REAL NOT NULL DEFAULT 200,
  criado_em    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel       TEXT NOT NULL DEFAULT 'aluno',
  turma_id    INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  matricula   TEXT,
  instituicao TEXT,
  criado_em  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS atividades (
  id             INTEGER PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  categoria      TEXT NOT NULL,
  local          TEXT,
  responsavel    TEXT,
  data_atividade TEXT NOT NULL,
  data_fim       TEXT,
  horas          REAL NOT NULL,
  comprovante    TEXT,
  texto          TEXT NOT NULL DEFAULT '',
  arquivo_nome   TEXT,
  validado       INTEGER NOT NULL DEFAULT 0,
  validado_por   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_em    TEXT,
  observacao     TEXT,
  criado_em      TEXT NOT NULL,
  atualizado_em  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_atividades_usuario ON atividades(usuario_id);

CREATE TABLE IF NOT EXISTS sessoes (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em  TEXT NOT NULL,
  expira_em  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT OR IGNORE INTO config(chave, valor) VALUES('meta_horas', '200');
INSERT OR IGNORE INTO config(chave, valor) VALUES('titulo_turma', 'Horas Complementares — Psicologia');
