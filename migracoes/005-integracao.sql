-- Integração com sistemas externos: chaves de API por professor, atividades
-- com origem rastreável e alunos pré-cadastrados pela importação.
-- Rodar uma vez:
-- wrangler d1 execute horas-complementares --remote --file=migracoes/005-integracao.sql

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

-- De onde veio a atividade e qual o id dela lá fora: é o que evita duplicar
-- quando o sistema de origem reenvia o mesmo lançamento.
ALTER TABLE atividades ADD COLUMN origem TEXT;
ALTER TABLE atividades ADD COLUMN origem_id TEXT;

-- Aluno criado pela importação antes de ter conta: entra sem senha e assume a
-- conta depois, no cadastro, com o mesmo e-mail.
ALTER TABLE usuarios ADD COLUMN pre_cadastrado INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_atividades_origem
  ON atividades(origem, origem_id) WHERE origem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chaves_professor ON chaves_api(professor_id);
