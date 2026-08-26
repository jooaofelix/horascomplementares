-- Esquema único: roda no SQLite local (node:sqlite) e no Cloudflare D1.

CREATE TABLE IF NOT EXISTS cursos (
  id                 INTEGER PRIMARY KEY,
  nome               TEXT NOT NULL,
  sigla              TEXT,
  horas_obrigatorias REAL NOT NULL DEFAULT 200,
  ativo              INTEGER NOT NULL DEFAULT 1,
  criado_em          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias (
  id        INTEGER PRIMARY KEY,
  nome      TEXT NOT NULL UNIQUE,
  descricao TEXT,
  ordem     INTEGER NOT NULL DEFAULT 0,
  ativa     INTEGER NOT NULL DEFAULT 1,
  criada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regras_categoria (
  id             INTEGER PRIMARY KEY,
  curso_id       INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  categoria_id   INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  limite_horas   REAL,
  percentual_max REAL,
  UNIQUE(curso_id, categoria_id)
);

CREATE TABLE IF NOT EXISTS coordenacoes (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  curso_id   INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  criada_em  TEXT NOT NULL,
  PRIMARY KEY (usuario_id, curso_id)
);

CREATE TABLE IF NOT EXISTS turmas (
  id           INTEGER PRIMARY KEY,
  nome         TEXT NOT NULL,
  periodo      TEXT,
  codigo       TEXT,
  professor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  curso_id     INTEGER REFERENCES cursos(id) ON DELETE SET NULL,
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
  pode_convidar INTEGER NOT NULL DEFAULT 0,
  pre_cadastrado INTEGER NOT NULL DEFAULT 0,
  curso_id    INTEGER REFERENCES cursos(id) ON DELETE SET NULL,
  semestre    TEXT,
  criado_em  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS atividades (
  id             INTEGER PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  categoria      TEXT NOT NULL,
  categoria_id   INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  local          TEXT,
  responsavel    TEXT,
  data_atividade TEXT NOT NULL,
  data_fim       TEXT,
  horas          REAL NOT NULL,
  comprovante    TEXT,
  texto          TEXT NOT NULL DEFAULT '',
  arquivo_nome   TEXT,
  origem         TEXT,
  origem_id      TEXT,
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

CREATE TABLE IF NOT EXISTS chaves_api (
  id            INTEGER PRIMARY KEY,
  nome          TEXT NOT NULL,
  prefixo       TEXT NOT NULL UNIQUE,
  segredo_hash  TEXT NOT NULL,
  professor_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em     TEXT NOT NULL,
  ultimo_uso_em TEXT,
  chamadas      INTEGER NOT NULL DEFAULT 0,
  revogada_em   TEXT
);

CREATE TABLE IF NOT EXISTS convites (
  id         INTEGER PRIMARY KEY,
  codigo     TEXT NOT NULL UNIQUE,
  observacao TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em  TEXT NOT NULL,
  usado_em   TEXT
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT OR IGNORE INTO categorias(nome, ordem, criada_em) VALUES
  ('Observação em campo', 1, datetime('now')),
  ('Registro cursivo', 2, datetime('now')),
  ('Análise de material', 3, datetime('now')),
  ('Leitura / fichamento', 4, datetime('now')),
  ('Supervisão', 5, datetime('now')),
  ('Seminário / evento', 6, datetime('now')),
  ('Extensão / projeto', 7, datetime('now')),
  ('Outro', 99, datetime('now'));

INSERT OR IGNORE INTO config(chave, valor) VALUES('meta_horas', '200');
INSERT OR IGNORE INTO config(chave, valor) VALUES('titulo_turma', 'Horas Complementares — Psicologia');
