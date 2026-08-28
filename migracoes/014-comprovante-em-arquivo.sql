-- O aluno passa a anexar o comprovante (PDF, foto do certificado) junto com a
-- atividade. Até aqui só o nome do arquivo era guardado; agora o arquivo em si
-- fica no sistema, com hash e tudo, como já acontece com aula e entrega.
-- Rodar: npm run banco:migrar

ALTER TABLE atividades ADD COLUMN arquivo_id INTEGER REFERENCES arquivos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_atividades_arquivo ON atividades(arquivo_id);
