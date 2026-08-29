-- Devolvida para correção, a atividade não é mais editada: o aluno reenvia. E
-- no reenvio ele informa quanto tempo levou corrigindo, que também vira hora.
-- Rodar: npm run banco:migrar

ALTER TABLE atividades ADD COLUMN horas_revisao REAL;
