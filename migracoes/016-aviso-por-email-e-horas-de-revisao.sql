-- Duas coisas que andam juntas na rotina da turma:
--   1. o professor recebe um e-mail a cada envio de aluno (e pode desligar);
--   2. quando ele devolve para revisão, o aluno diz quanto tempo levou para
--      refazer, e esse tempo entra na conta das horas.
-- Rodar: npm run banco:migrar

ALTER TABLE usuarios ADD COLUMN avisar_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE entregas ADD COLUMN horas_revisao REAL;
