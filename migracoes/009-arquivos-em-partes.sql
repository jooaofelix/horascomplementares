-- Sem bucket R2, o conteúdo do arquivo passa a ser guardado em partes: o D1
-- aceita até ~1 MB por valor, então um slide de vários MB cabe fatiado.
-- Rodar uma vez:
-- wrangler d1 execute horas-complementares --remote --file=migracoes/009-arquivos-em-partes.sql

CREATE TABLE IF NOT EXISTS arquivos_partes (
  chave    TEXT NOT NULL,
  parte    INTEGER NOT NULL,
  conteudo BLOB NOT NULL,
  PRIMARY KEY (chave, parte)
);

-- O que já estava guardado inteiro vira a parte zero.
INSERT OR IGNORE INTO arquivos_partes(chave, parte, conteudo)
SELECT chave, 0, conteudo FROM arquivos_conteudo;
