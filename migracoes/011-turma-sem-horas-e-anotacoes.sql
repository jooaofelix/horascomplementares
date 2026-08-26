-- Nem toda turma gera hora complementar: uma disciplina normal não gera, um
-- estágio ou projeto de extensão sim. E o professor passa a ter um caderno de
-- anotações por aluno, que o aluno não vê.
-- Rodar: npm run banco:migrar

ALTER TABLE turmas ADD COLUMN conta_horas INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS anotacoes (
  id            INTEGER PRIMARY KEY,
  aluno_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  autor_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  texto         TEXT NOT NULL,
  criada_em     TEXT NOT NULL,
  atualizada_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anotacoes_aluno ON anotacoes(aluno_id, id);
