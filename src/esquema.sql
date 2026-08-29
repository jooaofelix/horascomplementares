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
  conta_horas  INTEGER NOT NULL DEFAULT 1,
  criado_em    TEXT NOT NULL
);

-- Uma sala (turma) guarda várias matérias, cada uma com o seu professor. É daí
-- que sai o resto: o aluno entra na sala com um código e passa a ter todos os
-- professores dela; o professor cria uma matéria em cada sala em que dá aula.
CREATE TABLE IF NOT EXISTS materias (
  id           INTEGER PRIMARY KEY,
  turma_id     INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  professor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  conta_horas  INTEGER NOT NULL DEFAULT 0,
  criada_em    TEXT NOT NULL
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
  avisar_email  INTEGER NOT NULL DEFAULT 1,
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
  arquivo_id     INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
  analise_arquivo_id INTEGER REFERENCES arquivos(id) ON DELETE SET NULL,
  origem         TEXT,
  origem_id      TEXT,
  status         TEXT NOT NULL DEFAULT 'pendente',
  horas_aprovadas REAL,
  motivo         TEXT,
  analisado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  analisado_em   TEXT,
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

-- Caderno do professor sobre cada aluno. O aluno nunca vê.
CREATE TABLE IF NOT EXISTS anotacoes (
  id            INTEGER PRIMARY KEY,
  aluno_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  autor_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  texto         TEXT NOT NULL,
  criada_em     TEXT NOT NULL,
  atualizada_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id           INTEGER PRIMARY KEY,
  entidade     TEXT NOT NULL,
  entidade_id  INTEGER NOT NULL,
  acao         TEXT NOT NULL,
  descricao    TEXT NOT NULL,
  dados        TEXT,
  usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nome TEXT,
  papel        TEXT,
  ip           TEXT,
  criado_em    TEXT NOT NULL
);

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

-- Conteúdo dos arquivos quando o destino é o próprio banco (sem R2). Fica em
-- partes porque o D1 aceita cerca de 1 MB por valor.
CREATE TABLE IF NOT EXISTS arquivos_conteudo (
  chave    TEXT PRIMARY KEY,
  conteudo BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS arquivos_partes (
  chave    TEXT NOT NULL,
  parte    INTEGER NOT NULL,
  conteudo BLOB NOT NULL,
  PRIMARY KEY (chave, parte)
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

-- Uma aula (e uma tarefa) pode ir para mais de uma matéria: o professor publica
-- uma vez para as suas turmas de 3A e 3B em vez de repetir o trabalho.
CREATE TABLE IF NOT EXISTS aulas_materias (
  aula_id    INTEGER NOT NULL REFERENCES aulas(id) ON DELETE CASCADE,
  materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  PRIMARY KEY (aula_id, materia_id)
);

CREATE TABLE IF NOT EXISTS tarefas_materias (
  tarefa_id  INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  PRIMARY KEY (tarefa_id, materia_id)
);

-- Legado: o vínculo por turma que veio antes das matérias. Nada lê mais daqui;
-- a tabela fica porque é dela que a migração 012 tira o vínculo antigo.
CREATE TABLE IF NOT EXISTS aulas_turmas (
  aula_id  INTEGER NOT NULL REFERENCES aulas(id) ON DELETE CASCADE,
  turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  PRIMARY KEY (aula_id, turma_id)
);

CREATE TABLE IF NOT EXISTS tarefas_turmas (
  tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  turma_id  INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  PRIMARY KEY (tarefa_id, turma_id)
);

CREATE TABLE IF NOT EXISTS materiais (
  id         INTEGER PRIMARY KEY,
  turma_id   INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  materia_id INTEGER REFERENCES materias(id) ON DELETE CASCADE,
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
  nota_maxima     REAL,
  categoria_id    INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  publicada       INTEGER NOT NULL DEFAULT 1,
  criada_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criada_em       TEXT NOT NULL,
  atualizada_em   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entregas (
  id            INTEGER PRIMARY KEY,
  nota          REAL,
  horas_revisao REAL,
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
CREATE INDEX IF NOT EXISTS idx_materias_turma ON materias(turma_id);
CREATE INDEX IF NOT EXISTS idx_materias_professor ON materias(professor_id);
CREATE INDEX IF NOT EXISTS idx_materiais_materia ON materiais(materia_id);
CREATE INDEX IF NOT EXISTS idx_aulas_materias_materia ON aulas_materias(materia_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_materias_materia ON tarefas_materias(materia_id);

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
