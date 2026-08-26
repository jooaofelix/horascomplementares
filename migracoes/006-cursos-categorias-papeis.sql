-- Estrutura acadêmica: cursos com carga obrigatória, categorias cadastráveis e
-- limite de horas por categoria dentro de cada curso. Papéis ganham coordenador
-- e administrador.
-- Rodar uma vez:
-- wrangler d1 execute horas-complementares --remote --file=migracoes/006-cursos-categorias-papeis.sql

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

-- Limite de horas de uma categoria dentro de um curso. Sem linha aqui, a
-- categoria vale sem teto para aquele curso.
CREATE TABLE IF NOT EXISTS regras_categoria (
  id             INTEGER PRIMARY KEY,
  curso_id       INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  categoria_id   INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  limite_horas   REAL,
  percentual_max REAL,
  UNIQUE(curso_id, categoria_id)
);

-- Um coordenador pode responder por mais de um curso.
CREATE TABLE IF NOT EXISTS coordenacoes (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  curso_id   INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  criada_em  TEXT NOT NULL,
  PRIMARY KEY (usuario_id, curso_id)
);

ALTER TABLE usuarios ADD COLUMN curso_id INTEGER REFERENCES cursos(id) ON DELETE SET NULL;
ALTER TABLE usuarios ADD COLUMN semestre TEXT;
ALTER TABLE turmas ADD COLUMN curso_id INTEGER REFERENCES cursos(id) ON DELETE SET NULL;
ALTER TABLE atividades ADD COLUMN categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL;

-- Categorias que já existiam no código viram linhas editáveis.
INSERT OR IGNORE INTO categorias(nome, ordem, criada_em) VALUES
  ('Observação em campo', 1, datetime('now')),
  ('Registro cursivo', 2, datetime('now')),
  ('Análise de material', 3, datetime('now')),
  ('Leitura / fichamento', 4, datetime('now')),
  ('Supervisão', 5, datetime('now')),
  ('Seminário / evento', 6, datetime('now')),
  ('Extensão / projeto', 7, datetime('now')),
  ('Outro', 99, datetime('now'));

-- Curso padrão para as turmas que já existem, com a maior meta já usada.
INSERT INTO cursos(nome, horas_obrigatorias, criado_em)
SELECT 'Curso padrão', COALESCE((SELECT MAX(meta_horas) FROM turmas), 200), datetime('now')
 WHERE NOT EXISTS (SELECT 1 FROM cursos);

UPDATE turmas SET curso_id = (SELECT id FROM cursos ORDER BY id LIMIT 1) WHERE curso_id IS NULL;
UPDATE usuarios
   SET curso_id = (SELECT t.curso_id FROM turmas t WHERE t.id = usuarios.turma_id)
 WHERE papel = 'aluno' AND curso_id IS NULL;
UPDATE atividades
   SET categoria_id = (SELECT c.id FROM categorias c WHERE c.nome = atividades.categoria)
 WHERE categoria_id IS NULL;

-- Quem já podia convidar vira administrador da faculdade.
UPDATE usuarios SET papel = 'admin' WHERE papel = 'professor' AND pode_convidar = 1;

CREATE INDEX IF NOT EXISTS idx_usuarios_curso ON usuarios(curso_id);
CREATE INDEX IF NOT EXISTS idx_regras_curso ON regras_categoria(curso_id);
