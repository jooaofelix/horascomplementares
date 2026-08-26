-- Esquema do primeiro commit, guardado como ponto de partida do teste de
-- migrações: é o estado em que um banco antigo de verdade se encontra.
CREATE TABLE IF NOT EXISTS usuarios (
      id         INTEGER PRIMARY KEY,
      nome       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      papel      TEXT NOT NULL DEFAULT 'aluno',
      criado_em  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS atividades (
      id             INTEGER PRIMARY KEY,
      usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      titulo         TEXT NOT NULL,
      categoria      TEXT NOT NULL,
      data_atividade TEXT NOT NULL,
      horas          REAL NOT NULL,
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
