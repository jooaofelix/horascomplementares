-- A lista de atividades do aluno vira uma caixa de entrada: o que ele mandou e
-- o que o professor respondeu. Para saber o que ainda não foi lido, guardamos
-- quando o aluno abriu cada conversa pela última vez.
-- Rodar: npm run banco:migrar

ALTER TABLE atividades ADD COLUMN lida_em TEXT;
