-- APAGA TUDO o que foi cadastrado: pessoas, turmas, matérias, aulas, tarefas,
-- entregas, arquivos e horas. Só as categorias de atividade continuam, porque
-- nascem com o esquema. Serve para tirar a demonstração de cima do banco
-- publicado e recomeçar limpo:
--
--   npx wrangler d1 execute horas-complementares --remote --file=scripts/limpar.sql
--
-- Não tem volta. Se houver algo de verdade lá dentro, faça antes:
--   npm run banco:backup

DELETE FROM anotacoes;
DELETE FROM entregas;
DELETE FROM tarefas_materias;
DELETE FROM tarefas_turmas;
DELETE FROM tarefas;
DELETE FROM materiais;
DELETE FROM aulas_materias;
DELETE FROM aulas_turmas;
DELETE FROM aulas;
DELETE FROM arquivos_partes;
DELETE FROM arquivos_conteudo;
DELETE FROM arquivos;
DELETE FROM atividades;
DELETE FROM auditoria;
DELETE FROM sessoes;
DELETE FROM chaves_api;
DELETE FROM convites;
DELETE FROM materias;
DELETE FROM coordenacoes;
DELETE FROM turmas;
DELETE FROM regras_categoria;
DELETE FROM usuarios;
DELETE FROM cursos;
