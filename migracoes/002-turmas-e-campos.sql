-- Aplica em bancos que já existem (criados antes das turmas).
-- Rodar uma vez: wrangler d1 execute horas-complementares --remote --file=migracoes/002-turmas-e-campos.sql

CREATE TABLE IF NOT EXISTS turmas (
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL,
  periodo    TEXT,
  meta_horas REAL NOT NULL DEFAULT 200,
  criado_em  TEXT NOT NULL
);

ALTER TABLE usuarios ADD COLUMN turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL;
ALTER TABLE usuarios ADD COLUMN matricula TEXT;

ALTER TABLE atividades ADD COLUMN local TEXT;
ALTER TABLE atividades ADD COLUMN responsavel TEXT;
ALTER TABLE atividades ADD COLUMN data_fim TEXT;
ALTER TABLE atividades ADD COLUMN comprovante TEXT;

CREATE INDEX IF NOT EXISTS idx_usuarios_turma ON usuarios(turma_id);
