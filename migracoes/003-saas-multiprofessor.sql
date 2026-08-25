-- Cada professor passa a ser dono das próprias turmas, e o aluno entra por um
-- código de turma. Rodar uma vez:
-- wrangler d1 execute horas-complementares --remote --file=migracoes/003-saas-multiprofessor.sql

ALTER TABLE turmas ADD COLUMN professor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE turmas ADD COLUMN codigo TEXT;
ALTER TABLE usuarios ADD COLUMN instituicao TEXT;

-- Turmas que já existiam ficam com o primeiro professor cadastrado.
UPDATE turmas
   SET professor_id = (SELECT id FROM usuarios WHERE papel = 'professor' ORDER BY id LIMIT 1)
 WHERE professor_id IS NULL;

-- E ganham um código para os alunos usarem.
UPDATE turmas SET codigo = upper(substr(hex(randomblob(4)), 1, 6)) WHERE codigo IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_turmas_codigo ON turmas(codigo);
CREATE INDEX IF NOT EXISTS idx_turmas_professor ON turmas(professor_id);
