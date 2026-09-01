// O script scripts/mudar-papel.mjs mexe direto no banco publicado, onde não há
// tela nem confirmação. Estes testes rodam o miolo dele contra um banco de
// verdade em memória — é o ensaio antes do ensaio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoLocal } from '../src/sqlite.js';
import { gerarHash } from '../src/auth.js';
import { planoDeMudanca, aplicarPlano } from '../scripts/mudar-papel.mjs';

async function bancoComGente() {
  const bd = bancoLocal(':memory:');
  const agora = new Date().toISOString();
  const senha = await gerarHash('senha123', 1000);

  const criar = async (nome, email, papel) => {
    const { ultimoId } = await bd.run(
      `INSERT INTO usuarios(nome, email, senha_hash, papel, instituicao, pode_convidar, criado_em)
       VALUES(?, ?, ?, ?, 'UniExemplo', 1, ?)`,
      nome, email, senha, papel, agora,
    );
    return ultimoId;
  };

  const marina = await criar('Profa. Marina', 'marina@ex.br', 'admin');
  const carlos = await criar('Prof. Carlos', 'carlos@ex.br', 'professor');

  const { ultimoId: curso } = await bd.run(
    "INSERT INTO cursos(nome, horas_obrigatorias, criado_em) VALUES('Psicologia', 100, ?)", agora);
  const { ultimoId: turma } = await bd.run(
    `INSERT INTO turmas(nome, codigo, professor_id, curso_id, meta_horas, criado_em)
     VALUES('Noite', 'NOI123', ?, ?, 100, ?)`,
    carlos, curso, agora,
  );
  await bd.run(
    "INSERT INTO materias(turma_id, nome, professor_id, criada_em) VALUES(?, 'Observação', ?, ?)",
    turma, carlos, agora,
  );
  await bd.run(
    `INSERT INTO chaves_api(nome, prefixo, segredo_hash, professor_id, criada_em)
     VALUES('Sistema', 'ABCD1234', 'x', ?, ?)`,
    carlos, agora,
  );
  await bd.run('INSERT INTO coordenacoes(usuario_id, curso_id, criada_em) VALUES(?, ?, ?)',
    carlos, curso, agora);

  return { bd, marina, carlos, curso, turma };
}

test('o ensaio conta o que vai acontecer e não mexe em nada', async () => {
  const { bd, carlos } = await bancoComGente();
  const plano = await planoDeMudanca(bd, { email: 'CARLOS@ex.br', papel: 'aluno' });

  assert.equal(plano.conta.id, carlos, 'acha a conta sem se importar com maiúsculas');
  const contado = plano.passos.map((p) => p.conta).join('\n');
  assert.match(contado, /papel: professor → aluno/);
  assert.match(contado, /revoga 1 chave/);
  assert.match(contado, /larga a coordenação de: Psicologia/);
  assert.match(contado, /1 sala\(s\) ficam sem dono: Noite/);
  assert.match(contado, /1 matéria\(s\) ficam sem professor: Noite\/Observação/);
  assert.match(plano.avisos.join('\n'), /Sem sala/, 'avisa que o aluno fica sem mural');

  const antes = await bd.get('SELECT papel FROM usuarios WHERE id = ?', carlos);
  assert.equal(antes.papel, 'professor', 'montar o plano não muda o banco');
});

test('aplicar solta as salas, revoga a chave e larga a coordenação', async () => {
  const { bd, carlos, turma } = await bancoComGente();
  const plano = await planoDeMudanca(bd, { email: 'carlos@ex.br', papel: 'aluno', codigoTurma: 'noi123' });
  const depois = await aplicarPlano(bd, plano);

  assert.equal(depois.papel, 'aluno');
  assert.equal(depois.turma_id, turma, 'o código da sala vale em minúsculas');
  assert.ok(depois.curso_id, 'herda o curso da sala');

  const conta = await bd.get('SELECT instituicao, pode_convidar FROM usuarios WHERE id = ?', carlos);
  assert.equal(conta.instituicao, null);
  assert.equal(conta.pode_convidar, 0);
  assert.ok((await bd.get('SELECT revogada_em FROM chaves_api WHERE professor_id = ?', carlos)).revogada_em);
  assert.equal(await bd.get('SELECT 1 FROM coordenacoes WHERE usuario_id = ?', carlos), null);
  assert.equal((await bd.get('SELECT professor_id FROM turmas WHERE id = ?', turma)).professor_id, null);
  assert.equal((await bd.get('SELECT professor_id FROM materias WHERE turma_id = ?', turma)).professor_id, null);

  const auditoria = await bd.get(
    "SELECT descricao, usuario_nome FROM auditoria WHERE entidade = 'usuario' AND entidade_id = ?", carlos);
  assert.match(auditoria.descricao, /carlos@ex\.br: professor → aluno/);
  assert.equal(auditoria.usuario_nome, 'scripts/mudar-papel');
});

test('o último admin não vira aluno sem querer', async () => {
  const { bd, marina } = await bancoComGente();
  const plano = await planoDeMudanca(bd, { email: 'marina@ex.br', papel: 'aluno' });
  assert.equal(plano.impedimentos.length, 1);
  assert.match(plano.impedimentos[0], /Promova alguém a admin antes/);

  // Só o impedimento trava; o plano em si continua pronto para quem insistir.
  const depois = await aplicarPlano(bd, plano);
  assert.equal(depois.papel, 'aluno');
  assert.equal((await bd.get('SELECT papel FROM usuarios WHERE id = ?', marina)).papel, 'aluno');
});

test('promover de volta a professor não mexe no que ficou solto', async () => {
  const { bd, carlos, turma } = await bancoComGente();
  await aplicarPlano(bd, await planoDeMudanca(bd, { email: 'carlos@ex.br', papel: 'aluno' }));
  const volta = await aplicarPlano(bd, await planoDeMudanca(bd, { email: 'carlos@ex.br', papel: 'professor' }));

  assert.equal(volta.papel, 'professor');
  assert.equal((await bd.get('SELECT professor_id FROM turmas WHERE id = ?', turma)).professor_id, null,
    'a sala solta continua solta: quem devolve é o admin');
  assert.ok((await bd.get('SELECT revogada_em FROM chaves_api WHERE professor_id = ?', carlos)).revogada_em,
    'chave revogada não ressuscita');
});

test('quem é promovido a admin ganha o direito de convidar professores', async () => {
  const { bd, carlos } = await bancoComGente();
  // Sem isso a aba Convites responde 403 e o admin novo não chama ninguém.
  await bd.run('UPDATE usuarios SET pode_convidar = 0 WHERE id = ?', carlos);

  const plano = await planoDeMudanca(bd, { email: 'carlos@ex.br', papel: 'admin' });
  assert.match(plano.passos.map((p) => p.conta).join('\n'), /passa a poder gerar convites/);
  await aplicarPlano(bd, plano);

  const conta = await bd.get('SELECT papel, pode_convidar FROM usuarios WHERE id = ?', carlos);
  assert.equal(conta.papel, 'admin');
  assert.equal(conta.pode_convidar, 1);
});

test('e-mail desconhecido e papel inventado param antes de qualquer escrita', async () => {
  const { bd } = await bancoComGente();
  await assert.rejects(
    planoDeMudanca(bd, { email: 'ninguem@ex.br', papel: 'aluno' }), /Nenhuma conta/);
  await assert.rejects(
    planoDeMudanca(bd, { email: 'carlos@ex.br', papel: 'chefe' }), /Papel inválido/);
  await assert.rejects(
    planoDeMudanca(bd, { email: 'carlos@ex.br', papel: 'aluno', codigoTurma: 'XXXXXX' }), /Nenhuma sala/);
});
