-- A turma vira a sala: é dela o código de acesso que o professor passa. Dentro
-- dela ficam as matérias, uma por professor — é assim que o aluno passa a ter
-- vários professores e o professor várias matérias, em salas diferentes.
-- Rodar: npm run banco:migrar

CREATE TABLE IF NOT EXISTS materias (
  id           INTEGER PRIMARY KEY,
  turma_id     INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  professor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  conta_horas  INTEGER NOT NULL DEFAULT 0,
  criada_em    TEXT NOT NULL
);

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

ALTER TABLE materiais ADD COLUMN materia_id INTEGER REFERENCES materias(id) ON DELETE CASCADE;

-- Cada turma que já existia vira uma sala com uma matéria de mesmo nome: nada
-- muda de lugar para quem já usava, e o professor cria as outras depois.
INSERT INTO materias(turma_id, nome, professor_id, conta_horas, criada_em)
SELECT t.id, t.nome, t.professor_id, COALESCE(t.conta_horas, 1), datetime('now')
  FROM turmas t
 WHERE NOT EXISTS (SELECT 1 FROM materias m WHERE m.turma_id = t.id);

-- O vínculo antigo era com a turma. Ele passa para a primeira matéria da sala,
-- que é justamente a que acabou de nascer daquela turma — e continua sendo ela
-- se esta migração rodar de novo.
INSERT OR IGNORE INTO aulas_materias(aula_id, materia_id)
SELECT at.aula_id, (SELECT MIN(m.id) FROM materias m WHERE m.turma_id = at.turma_id)
  FROM aulas_turmas at
 WHERE (SELECT MIN(m.id) FROM materias m WHERE m.turma_id = at.turma_id) IS NOT NULL;

INSERT OR IGNORE INTO tarefas_materias(tarefa_id, materia_id)
SELECT tt.tarefa_id, (SELECT MIN(m.id) FROM materias m WHERE m.turma_id = tt.turma_id)
  FROM tarefas_turmas tt
 WHERE (SELECT MIN(m.id) FROM materias m WHERE m.turma_id = tt.turma_id) IS NOT NULL;

UPDATE materiais
   SET materia_id = (SELECT MIN(m.id) FROM materias m WHERE m.turma_id = materiais.turma_id)
 WHERE materia_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_materias_turma ON materias(turma_id);
CREATE INDEX IF NOT EXISTS idx_materias_professor ON materias(professor_id);
CREATE INDEX IF NOT EXISTS idx_materiais_materia ON materiais(materia_id);
CREATE INDEX IF NOT EXISTS idx_aulas_materias_materia ON aulas_materias(materia_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_materias_materia ON tarefas_materias(materia_id);
