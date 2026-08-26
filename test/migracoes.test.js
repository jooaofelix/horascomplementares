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

const migracoes = () => fs.readdirSync('migracoes').filter((f) => f.endsWith('.sql')).sort();

function aplicar(db, arquivos) {
  for (const arquivo of arquivos) {
    for (const comando of comandos(fs.readFileSync(path.join('migracoes', arquivo), 'utf8'))) {
      try {
        db.exec(comando);
      } catch (e) {
        assert.match(e.message, TOLERAVEL, `${arquivo}: ${e.message}\n  ${comando.slice(0, 120)}`);
      }
    }
  }
}

function bancoMigrado() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('test/esquema-inicial.sql', 'utf8'));
  const arquivos = migracoes();
  aplicar(db, arquivos);
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

  aplicar(db, migracoes());
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

// Estrutura certa não basta: o conteúdo antigo precisa chegar do outro lado. A
// turma vira sala com uma matéria, e o que estava preso à turma passa para ela.
test('a migração das matérias leva junto as aulas, as tarefas e os materiais', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('test/esquema-inicial.sql', 'utf8'));
  aplicar(db, migracoes().filter((a) => a < '012'));

  const agora = new Date().toISOString();
  db.exec(`
    INSERT INTO usuarios(id, nome, email, senha_hash, papel, criado_em)
      VALUES(1, 'Marina', 'm@x.br', 'h', 'professor', '${agora}');
    INSERT INTO turmas(id, nome, codigo, professor_id, meta_horas, conta_horas, criado_em)
      VALUES(1, '3A', 'AAA111', 1, 200, 0, '${agora}'), (2, 'Estágio', 'BBB222', 1, 300, 1, '${agora}');
    INSERT INTO aulas(id, turma_id, titulo, criada_em, atualizada_em)
      VALUES(1, 1, 'Aula 3', '${agora}', '${agora}');
    INSERT INTO aulas_turmas(aula_id, turma_id) VALUES(1, 1), (1, 2);
    INSERT INTO tarefas(id, turma_id, aula_id, titulo, criada_em, atualizada_em)
      VALUES(1, 1, 1, 'Registro', '${agora}', '${agora}');
    INSERT INTO tarefas_turmas(tarefa_id, turma_id) VALUES(1, 1), (1, 2);
    INSERT INTO materiais(id, turma_id, aula_id, tipo, titulo, criado_em)
      VALUES(1, 1, 1, 'link', 'Roteiro', '${agora}');
  `);

  aplicar(db, ['012-materias-por-turma.sql']);

  const nomes = (sql) => db.prepare(sql).all().map((l) => l.nome).sort();
  assert.deepEqual(
    db.prepare('SELECT nome, conta_horas FROM materias ORDER BY id').all()
      .map((m) => `${m.nome}: ${m.conta_horas}`),
    ['3A: 0', 'Estágio: 1'],
    'cada turma virou uma sala com uma matéria, e o "gera horas" veio junto',
  );
  const ligadas = `SELECT m.nome FROM aulas_materias am JOIN materias m ON m.id = am.materia_id`;
  assert.deepEqual(nomes(ligadas), ['3A', 'Estágio'], 'a aula continua nas duas turmas');
  assert.deepEqual(
    nomes(`SELECT m.nome FROM tarefas_materias tm JOIN materias m ON m.id = tm.materia_id`),
    ['3A', 'Estágio'],
  );
  assert.equal(db.prepare('SELECT materia_id FROM materiais WHERE id = 1').get().materia_id, 1);

  // Depois que um colega abre a matéria dele na mesma sala, rodar de novo não
  // pode empurrar as aulas antigas para dentro dela.
  db.exec(`
    INSERT INTO usuarios(id, nome, email, senha_hash, papel, criado_em)
      VALUES(3, 'Helena', 'h@x.br', 'h', 'professor', '${agora}');
    INSERT INTO materias(turma_id, nome, professor_id, conta_horas, criada_em)
      VALUES(1, 'Estatística', 3, 0, '${agora}');
  `);
  aplicar(db, ['012-materias-por-turma.sql']);
  assert.deepEqual(nomes(ligadas), ['3A', 'Estágio'], 'a matéria da colega não herdou nada');
});
