-- Fluxo formal de análise: a atividade deixa de ser "validada sim ou não" e
-- passa a ter status, horas aprovadas próprias e trilha de auditoria imutável.
-- Rodar uma vez:
-- wrangler d1 execute horas-complementares --remote --file=migracoes/008-status-e-auditoria.sql

ALTER TABLE atividades ADD COLUMN status TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE atividades ADD COLUMN horas_aprovadas REAL;
ALTER TABLE atividades ADD COLUMN motivo TEXT;
ALTER TABLE atividades ADD COLUMN analisado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE atividades ADD COLUMN analisado_em TEXT;

-- O que já estava validado vira aprovado, com as horas declaradas.
UPDATE atividades SET status = 'aprovado', horas_aprovadas = horas,
       analisado_por = validado_por, analisado_em = validado_em
 WHERE validado = 1;

-- Nada aqui é apagado ou editado: cada passo vira uma linha nova.
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

CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id, id);
CREATE INDEX IF NOT EXISTS idx_atividades_status ON atividades(status);
