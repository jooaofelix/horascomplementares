-- Uma aula (e uma tarefa) passa a alcançar várias turmas: o professor publica
-- uma vez para 3A e 3B em vez de repetir o trabalho.
-- Rodar uma vez — ou simplesmente: npm run banco:migrar

CREATE TABLE IF NOT EXISTS aulas_turmas (
  aula_id  INTEGER NOT NULL REFERENCES aulas(id) ON DELETE CASCADE,
  turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  PRIMARY KEY (aula_id, turma_id)
);

CREATE TABLE IF NOT EXISTS tarefas_turmas (
  tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  turma_id  INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  PRIMARY KEY (tarefa_id, turma_id)
);

-- O que já existe continua valendo: a turma de origem vira o primeiro vínculo.
INSERT OR IGNORE INTO aulas_turmas(aula_id, turma_id)
SELECT id, turma_id FROM aulas WHERE turma_id IS NOT NULL;

INSERT OR IGNORE INTO tarefas_turmas(tarefa_id, turma_id)
SELECT id, turma_id FROM tarefas WHERE turma_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aulas_turmas_turma ON aulas_turmas(turma_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_turmas_turma ON tarefas_turmas(turma_id);
