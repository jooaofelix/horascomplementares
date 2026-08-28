-- A análise do aluno nem sempre é digitada: muita gente escreve no Word e traz
-- o PDF pronto. A atividade passa a ter dois anexos com papéis diferentes — o
-- relatório (a análise) e o comprovante (o certificado).
-- Rodar: npm run banco:migrar

ALTER TABLE atividades ADD COLUMN analise_arquivo_id INTEGER REFERENCES arquivos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_atividades_analise_arquivo ON atividades(analise_arquivo_id);
