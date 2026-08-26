-- Matéria que não gera hora complementar avalia do jeito normal: com nota. A
-- tarefa passa a ter uma nota máxima e a entrega, a nota que o professor deu.
-- Rodar: npm run banco:migrar

ALTER TABLE tarefas ADD COLUMN nota_maxima REAL;
ALTER TABLE entregas ADD COLUMN nota REAL;
