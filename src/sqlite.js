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
  db.exec('CREATE INDEX IF NOT EXISTS idx_usuarios_turma ON usuarios(turma_id)');
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
