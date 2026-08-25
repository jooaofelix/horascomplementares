-- Criar conta de professor passa a exigir um convite de uso único.
-- Rodar uma vez:
-- wrangler d1 execute horas-complementares --remote --file=migracoes/004-convites-de-professor.sql

CREATE TABLE IF NOT EXISTS convites (
  id         INTEGER PRIMARY KEY,
  codigo     TEXT NOT NULL UNIQUE,
  observacao TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em  TEXT NOT NULL,
  usado_em   TEXT
);

ALTER TABLE usuarios ADD COLUMN pode_convidar INTEGER NOT NULL DEFAULT 0;

-- Quem já é professor aqui continua sendo, e o primeiro deles fica com a
-- permissão de convidar os outros.
UPDATE usuarios
   SET pode_convidar = 1
 WHERE id = (SELECT id FROM usuarios WHERE papel = 'professor' ORDER BY id LIMIT 1);
