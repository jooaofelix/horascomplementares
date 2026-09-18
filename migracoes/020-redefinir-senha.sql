-- "Esqueci a senha". O código nunca é guardado em claro: fica só o SHA-256 dele,
-- como já fazemos com as chaves de integração.
-- Rodar: npm run banco:migrar

CREATE TABLE IF NOT EXISTS redefinicoes (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL,
  -- Quem gerou: nulo quando a própria pessoa pediu pela tela de entrada,
  -- preenchido quando o professor gerou o código para um aluno dele.
  criado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tentativas  INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL,
  expira_em   TEXT NOT NULL,
  usado_em    TEXT
);

CREATE INDEX IF NOT EXISTS idx_redefinicoes_usuario ON redefinicoes(usuario_id);
