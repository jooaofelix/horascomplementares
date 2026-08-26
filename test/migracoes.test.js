import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Um banco antigo de verdade não nasce do esquema atual: ele nasce do esquema
// de quando foi criado e recebe uma migração de cada vez. Este teste refaz esse
// caminho, que é onde os erros de ordem aparecem.

const TOLERAVEL = /duplicate column name|already exists/i;

const comandos = (sql) =>
  sql
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((c) => c.trim())
    .filter(Boolean);

const tabelas = (banco) =>
  banco
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((t) => t.name);

const colunas = (banco, tabela) =>
  banco.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);

function bancoMigrado() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('test/esquema-inicial.sql', 'utf8'));

  const arquivos = fs.readdirSync('migracoes').filter((f) => f.endsWith('.sql')).sort();
  for (const arquivo of arquivos) {
    for (const comando of comandos(fs.readFileSync(path.join('migracoes', arquivo), 'utf8'))) {
      try {
        db.exec(comando);
      } catch (e) {
        assert.match(e.message, TOLERAVEL, `${arquivo}: ${e.message}\n  ${comando.slice(0, 120)}`);
      }
    }
  }
  return { db, arquivos };
}

test('as migrações levam um banco antigo até o esquema atual', () => {
  const { db, arquivos } = bancoMigrado();
  assert.ok(arquivos.length >= 8, 'as migrações estão sendo encontradas');

  const atual = new DatabaseSync(':memory:');
  atual.exec(fs.readFileSync('src/esquema.sql', 'utf8'));

  const faltando = [];
  for (const tabela of tabelas(atual)) {
    if (!tabelas(db).includes(tabela)) {
      faltando.push(`tabela ${tabela}`);
      continue;
    }
    for (const coluna of colunas(atual, tabela)) {
      if (!colunas(db, tabela).includes(coluna)) faltando.push(`${tabela}.${coluna}`);
    }
  }
  assert.deepEqual(faltando, [], 'o banco migrado tem tudo o que o código espera');
});

test('rodar as migrações duas vezes não quebra nada', () => {
  const { db } = bancoMigrado();
  const antes = tabelas(db).sort();

  for (const arquivo of fs.readdirSync('migracoes').filter((f) => f.endsWith('.sql')).sort()) {
    for (const comando of comandos(fs.readFileSync(path.join('migracoes', arquivo), 'utf8'))) {
      try {
        db.exec(comando);
      } catch (e) {
        assert.match(e.message, TOLERAVEL, `na segunda passada: ${e.message}`);
      }
    }
  }
  assert.deepEqual(tabelas(db).sort(), antes);
});

test('o banco migrado aceita o uso normal do sistema', () => {
  const { db } = bancoMigrado();
  const agora = new Date().toISOString();

  db.prepare(
    `INSERT INTO usuarios(nome, email, senha_hash, papel, criado_em) VALUES(?, ?, ?, 'admin', ?)`,
  ).run('Coordenação', 'admin@x.br', 'hash', agora);
  db.prepare('INSERT INTO cursos(nome, horas_obrigatorias, criado_em) VALUES(?, ?, ?)')
    .run('Psicologia', 100, agora);
  db.prepare(
    `INSERT INTO turmas(nome, codigo, professor_id, curso_id, meta_horas, criado_em)
     VALUES(?, ?, 1, 1, 100, ?)`,
  ).run('Manhã', 'ABC123', agora);
  db.prepare(
    `INSERT INTO usuarios(nome, email, senha_hash, papel, turma_id, curso_id, criado_em)
     VALUES(?, ?, ?, 'aluno', 1, 1, ?)`,
  ).run('Ana', 'ana@x.br', 'hash', agora);
  db.prepare(
    `INSERT INTO atividades(usuario_id, titulo, categoria, data_atividade, horas, status, criado_em, atualizado_em)
     VALUES(2, ?, 'Outro', '2026-04-01', 4, 'pendente', ?, ?)`,
  ).run('Atividade de teste', agora, agora);
  db.prepare(
    `INSERT INTO auditoria(entidade, entidade_id, acao, descricao, criado_em) VALUES('atividade', 1, 'criada', ?, ?)`,
  ).run('Lançada no teste', agora);

  const linha = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'aprovado' THEN COALESCE(horas_aprovadas, horas) ELSE 0 END), 0) AS aprovadas
         FROM atividades`,
    )
    .get();
  assert.equal(linha.total, 1);
  assert.equal(linha.aprovadas, 0);
});
