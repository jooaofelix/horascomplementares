-- Camada didática: o professor publica aulas com materiais e tarefas, e o aluno
-- entrega ali mesmo. Entrega aceita vira hora complementar validada.
-- Rodar uma vez:
-- wrangler d1 execute horas-complementares --remote --file=migracoes/007-aulas-materiais-entregas.sql

CREATE TABLE IF NOT EXISTS arquivos (
  id           INTEGER PRIMARY KEY,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  tamanho      INTEGER NOT NULL,
  hash_sha256  TEXT NOT NULL,
  chave        TEXT NOT NULL UNIQUE,
  destino      TEXT NOT NULL,
  enviado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em    TEXT NOT NULL
);

-- Conteúdo dos arquivos quando o destino é o próprio banco (sem R2).
CREATE TABLE IF NOT EXISTS arquivos_conteudo (
  chave    TEXT PRIMARY KEY,
  conteudo BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS aulas (
  id            INTEGER PRIMARY KEY,
  turma_id      INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  descricao     TEXT,
  data_aula     TEXT,
  ordem         INTEGER NOT NULL DEFAULT 0,
  publicada     INTEGER NOT NULL DEFAULT 1,
  criada_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criada_em     TEXT NOT NULL,
  atualizada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materiais (
  id         INTEGER PRIMARY KEY,
  turma_id   INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  aula_id    INTEGER REFERENCES aulas(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL DEFAULT 'arquivo',
  titulo     TEXT NOT NULL,
  descricao  TEXT,
  url        TEXT,
  arquivo_id INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tarefas (
  id              INTEGER PRIMARY KEY,
  turma_id        INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  aula_id         INTEGER REFERENCES aulas(id) ON DELETE SET NULL,
  titulo          TEXT NOT NULL,
  enunciado       TEXT,
  prazo           TEXT,
  horas_sugeridas REAL,
  categoria_id    INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  publicada       INTEGER NOT NULL DEFAULT 1,
  criada_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criada_em       TEXT NOT NULL,
  atualizada_em   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entregas (
  id            INTEGER PRIMARY KEY,
  tarefa_id     INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  aluno_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto         TEXT NOT NULL DEFAULT '',
  arquivo_id    INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'enviada',
  observacao    TEXT,
  horas         REAL,
  atividade_id  INTEGER REFERENCES atividades(id) ON DELETE SET NULL,
  avaliada_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  avaliada_em   TEXT,
  enviada_em    TEXT NOT NULL,
  atualizada_em TEXT NOT NULL,
  UNIQUE(tarefa_id, aluno_id)
);

CREATE INDEX IF NOT EXISTS idx_aulas_turma ON aulas(turma_id);
CREATE INDEX IF NOT EXISTS idx_materiais_turma ON materiais(turma_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_turma ON tarefas(turma_id);
CREATE INDEX IF NOT EXISTS idx_entregas_tarefa ON entregas(tarefa_id);
