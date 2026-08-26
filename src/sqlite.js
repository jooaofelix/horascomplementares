// Banco local para desenvolvimento e para rodar na rede da faculdade.
// Só este arquivo depende do Node — o Worker usa src/d1.js no lugar dele.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CAMINHO_PADRAO = path.join(process.cwd(), 'data', 'horas.db');

export function abrirBanco(caminho = process.env.BANCO || CAMINHO_PADRAO) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
  garantirColunas(db);
  return db;
}

// Bancos criados antes das turmas ganham as colunas novas aqui — o esquema.sql
// só cria tabelas que ainda não existem, então não altera as antigas.
const COLUNAS_NOVAS = [
  ['usuarios', 'turma_id', 'INTEGER REFERENCES turmas(id) ON DELETE SET NULL'],
  ['usuarios', 'matricula', 'TEXT'],
  ['usuarios', 'instituicao', 'TEXT'],
  ['usuarios', 'pode_convidar', 'INTEGER NOT NULL DEFAULT 0'],
  ['usuarios', 'pre_cadastrado', 'INTEGER NOT NULL DEFAULT 0'],
  ['atividades', 'origem', 'TEXT'],
  ['atividades', 'status', "TEXT NOT NULL DEFAULT 'pendente'"],
  ['atividades', 'horas_aprovadas', 'REAL'],
  ['atividades', 'motivo', 'TEXT'],
  ['atividades', 'analisado_por', 'INTEGER REFERENCES usuarios(id) ON DELETE SET NULL'],
  ['atividades', 'analisado_em', 'TEXT'],
  ['atividades', 'categoria_id', 'INTEGER REFERENCES categorias(id) ON DELETE SET NULL'],
  ['usuarios', 'curso_id', 'INTEGER REFERENCES cursos(id) ON DELETE SET NULL'],
  ['usuarios', 'semestre', 'TEXT'],
  ['turmas', 'curso_id', 'INTEGER REFERENCES cursos(id) ON DELETE SET NULL'],
  ['atividades', 'origem_id', 'TEXT'],
  ['turmas', 'professor_id', 'INTEGER REFERENCES usuarios(id) ON DELETE SET NULL'],
  ['turmas', 'codigo', 'TEXT'],
  ['atividades', 'local', 'TEXT'],
  ['atividades', 'responsavel', 'TEXT'],
  ['atividades', 'data_fim', 'TEXT'],
  ['atividades', 'comprovante', 'TEXT'],
];

function garantirColunas(db) {
  for (const [tabela, coluna, tipo] of COLUNAS_NOVAS) {
    const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all();
    if (!colunas.some((c) => c.name === coluna)) {
      db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
    }
  }
  // Só depois das colunas existirem — em bancos antigos elas acabaram de nascer.
  db.exec(`
    UPDATE turmas
       SET professor_id = (SELECT id FROM usuarios WHERE papel = 'professor' ORDER BY id LIMIT 1)
     WHERE professor_id IS NULL;
    UPDATE turmas SET codigo = upper(substr(hex(randomblob(4)), 1, 6)) WHERE codigo IS NULL;
    CREATE INDEX IF NOT EXISTS idx_usuarios_turma ON usuarios(turma_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turmas_codigo ON turmas(codigo);
    CREATE INDEX IF NOT EXISTS idx_turmas_professor ON turmas(professor_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_atividades_origem
      ON atividades(origem, origem_id) WHERE origem_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_chaves_professor ON chaves_api(professor_id);
    CREATE INDEX IF NOT EXISTS idx_usuarios_curso ON usuarios(curso_id);
    CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id, id);
    CREATE INDEX IF NOT EXISTS idx_atividades_status ON atividades(status);
    UPDATE atividades SET status = 'aprovado', horas_aprovadas = horas
     WHERE validado = 1 AND status = 'pendente';
    CREATE INDEX IF NOT EXISTS idx_regras_curso ON regras_categoria(curso_id);

    -- Liga o que já existia à estrutura acadêmica nova. Numa instalação nova
    -- não há o que migrar, então nenhum curso é inventado: quem cria é o admin.
    INSERT INTO cursos(nome, horas_obrigatorias, criado_em)
    SELECT 'Curso padrão', COALESCE((SELECT MAX(meta_horas) FROM turmas), 200), datetime('now')
     WHERE NOT EXISTS (SELECT 1 FROM cursos)
       AND EXISTS (SELECT 1 FROM turmas);
    UPDATE turmas SET curso_id = (SELECT id FROM cursos ORDER BY id LIMIT 1) WHERE curso_id IS NULL;
    UPDATE usuarios
       SET curso_id = (SELECT t.curso_id FROM turmas t WHERE t.id = usuarios.turma_id)
     WHERE papel = 'aluno' AND curso_id IS NULL;
    UPDATE atividades
       SET categoria_id = (SELECT c.id FROM categorias c WHERE c.nome = atividades.categoria)
     WHERE categoria_id IS NULL;
    UPDATE usuarios SET papel = 'admin' WHERE papel = 'professor' AND pode_convidar = 1;

    -- Sem ninguém podendo convidar, o primeiro professor recebe a permissão.
    UPDATE usuarios
       SET pode_convidar = 1
     WHERE id = (SELECT id FROM usuarios WHERE papel = 'professor' ORDER BY id LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM usuarios WHERE pode_convidar = 1);
  `);
}

// Adapta o node:sqlite (síncrono) para a mesma interface assíncrona do D1.
export function adaptarSqlite(db) {
  return {
    async get(sql, ...parametros) {
      return db.prepare(sql).get(...parametros) ?? null;
    },
    async all(sql, ...parametros) {
      return db.prepare(sql).all(...parametros);
    },
    async run(sql, ...parametros) {
      const resultado = db.prepare(sql).run(...parametros);
      return { mudancas: resultado.changes, ultimoId: Number(resultado.lastInsertRowid) };
    },
    fechar: () => db.close(),
  };
}

export const bancoLocal = (caminho) => adaptarSqlite(abrirBanco(caminho));
