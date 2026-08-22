import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const CAMINHO_PADRAO = path.join(process.cwd(), 'data', 'horas.db');

export const CATEGORIAS = [
  'Observação em campo',
  'Registro cursivo',
  'Análise de material',
  'Leitura / fichamento',
  'Supervisão',
  'Seminário / evento',
  'Outro',
];

export function abrirBanco(caminho = process.env.BANCO || CAMINHO_PADRAO) {
  if (caminho !== ':memory:') {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
  }
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  criarEsquema(db);
  return db;
}

function criarEsquema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         INTEGER PRIMARY KEY,
      nome       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      papel      TEXT NOT NULL DEFAULT 'aluno',
      criado_em  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS atividades (
      id             INTEGER PRIMARY KEY,
      usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      titulo         TEXT NOT NULL,
      categoria      TEXT NOT NULL,
      data_atividade TEXT NOT NULL,
      horas          REAL NOT NULL,
      texto          TEXT NOT NULL DEFAULT '',
      arquivo_nome   TEXT,
      validado       INTEGER NOT NULL DEFAULT 0,
      validado_por   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      validado_em    TEXT,
      observacao     TEXT,
      criado_em      TEXT NOT NULL,
      atualizado_em  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_atividades_usuario ON atividades(usuario_id);

    CREATE TABLE IF NOT EXISTS sessoes (
      token      TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em  TEXT NOT NULL,
      expira_em  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `);
  db.prepare('INSERT OR IGNORE INTO config(chave, valor) VALUES(?, ?)').run('meta_horas', '200');
  db.prepare('INSERT OR IGNORE INTO config(chave, valor) VALUES(?, ?)').run(
    'titulo_turma',
    'Psicologia — Técnicas de Observação',
  );
}

export function lerConfig(db, chave) {
  const linha = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return linha ? linha.valor : null;
}

export function gravarConfig(db, chave, valor) {
  db.prepare(
    'INSERT INTO config(chave, valor) VALUES(?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor',
  ).run(chave, String(valor));
}
