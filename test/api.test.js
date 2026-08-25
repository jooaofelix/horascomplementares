import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoLocal } from '../src/sqlite.js';
import { criarServidor } from '../server.js';

async function subirServidor() {
  const bd = bancoLocal(':memory:');
  const servidor = criarServidor(bd);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${servidor.address().port}`,
    fechar: () => new Promise((r) => servidor.close(r)),
  };
}

function cliente(base) {
  let cookie = '';
  return async (caminho, { metodo = 'GET', corpo } = {}) => {
    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    for (const bruto of resposta.headers.getSetCookie()) {
      const par = bruto.split(';')[0];
      if (par.startsWith('sessao=')) cookie = par;
    }
    const tipo = resposta.headers.get('content-type') || '';
    return {
      status: resposta.status,
      dados: tipo.includes('json') ? await resposta.json() : await resposta.text(),
    };
  };
}

async function comAmbiente(fn) {
  const ambiente = await subirServidor();
  try {
    await fn(ambiente);
  } finally {
    await ambiente.fechar();
  }
}

const atividadeBase = {
  titulo: 'Observação livre no pátio',
  categoria: 'Observação em campo',
  local: 'EMEI Vila Nova — pátio',
  responsavel: 'Coordenadora Marta',
  data_atividade: '2026-03-14',
  horas: 2.5,
  comprovante: 'Certificado 2026/031',
  texto: 'Registro cursivo do terceiro encontro. Duas crianças em brincadeira paralela.',
};

async function criarProfessor(base, nome = 'Profa. Marina', email = 'marina@exemplo.br') {
  const c = cliente(base);
  const r = await c('/api/cadastro', {
    metodo: 'POST',
    corpo: { papel: 'professor', nome, email, senha: 'senha123', instituicao: 'UniExemplo' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return c;
}

async function criarTurma(professor, nome, meta_horas = 200, periodo = null) {
  const r = await professor('/api/turmas', { metodo: 'POST', corpo: { nome, meta_horas, periodo } });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return r.dados.turma;
}

async function criarAluno(base, nome, email, codigoTurma, extras = {}) {
  const c = cliente(base);
  const r = await c('/api/cadastro', {
    metodo: 'POST',
    corpo: { papel: 'aluno', nome, email, senha: 'senha123', codigo_turma: codigoTurma, ...extras },
  });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return c;
}

// ---------------------------------------------------------------- contas

test('professor se cadastra sozinho e a turma nasce com um código', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Técnicas de Observação', 120, '2026.1');
    assert.match(turma.codigo, /^[A-Z0-9]{6}$/);

    const eu = await professor('/api/eu');
    assert.equal(eu.dados.usuario.papel, 'professor');
    assert.equal(eu.dados.usuario.instituicao, 'UniExemplo');
    assert.equal(eu.dados.turmas.length, 1);
  });
});

test('o aluno entra pelo código da turma e herda a meta dela', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 120);
    const aluno = await criarAluno(base, 'Ana Ribeiro', 'ana@exemplo.br', turma.codigo, { matricula: '2026001' });

    const eu = await aluno('/api/eu');
    assert.equal(eu.dados.usuario.turma_nome, 'Manhã');
    assert.equal(eu.dados.usuario.matricula, '2026001');
    assert.equal(eu.dados.resumo.meta, 120);
    assert.equal(eu.dados.professor.nome, 'Profa. Marina');
  });
});

test('código minúsculo ou com espaços funciona; código errado é recusado', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 120);

    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br', ` ${turma.codigo.toLowerCase()} `);
    assert.equal((await aluno('/api/eu')).dados.usuario.turma_nome, 'Manhã');

    const c = cliente(base);
    const errado = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'aluno', nome: 'X', email: 'x@exemplo.br', senha: 'senha123', codigo_turma: 'ZZZZZZ' },
    });
    assert.equal(errado.status, 404);

    const semCodigo = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'aluno', nome: 'Y', email: 'y@exemplo.br', senha: 'senha123' },
    });
    assert.equal(semCodigo.status, 400);
    assert.match(semCodigo.dados.erro, /código da turma/i);
  });
});

test('a busca por código é pública e mostra a turma antes do cadastro', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 120, '2026.1');
    const anonimo = cliente(base);

    const achou = await anonimo('/api/turmas/localizar', { metodo: 'POST', corpo: { codigo: turma.codigo } });
    assert.equal(achou.status, 200);
    assert.equal(achou.dados.turma.nome, 'Manhã');
    assert.equal(achou.dados.turma.professor_nome, 'Profa. Marina');

    const nada = await anonimo('/api/turmas/localizar', { metodo: 'POST', corpo: { codigo: 'ZZZZZZ' } });
    assert.equal(nada.status, 404);
  });
});

test('e-mail repetido e senha curta são recusados', async () => {
  await comAmbiente(async ({ base }) => {
    await criarProfessor(base);
    const c = cliente(base);
    const repetido = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'professor', nome: 'Outra', email: 'marina@exemplo.br', senha: 'senha123' },
    });
    assert.equal(repetido.status, 409);

    const curta = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'professor', nome: 'Z', email: 'z@exemplo.br', senha: '123' },
    });
    assert.equal(curta.status, 400);
  });
});

test('login confere a senha e o logout encerra a sessão', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);

    const c = cliente(base);
    assert.equal((await c('/api/login', { metodo: 'POST', corpo: { email: 'ana@exemplo.br', senha: 'errada' } })).status, 401);
    assert.equal((await c('/api/login', { metodo: 'POST', corpo: { email: 'ana@exemplo.br', senha: 'senha123' } })).status, 200);

    assert.equal((await aluno('/api/logout', { metodo: 'POST' })).status, 200);
    assert.equal((await aluno('/api/eu')).dados.usuario, null);
    assert.equal((await aluno('/api/atividades')).status, 401);
  });
});

// ---------------------------------------------------------------- atividades

test('a ficha completa da atividade é gravada e entra no total lançado', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 120);
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);

    const criada = await aluno('/api/atividades', {
      metodo: 'POST',
      corpo: { ...atividadeBase, data_fim: '2026-03-16' },
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.dados));
    const a = criada.dados.atividade;
    assert.equal(a.local, 'EMEI Vila Nova — pátio');
    assert.equal(a.responsavel, 'Coordenadora Marta');
    assert.equal(a.data_fim, '2026-03-16');
    assert.equal(a.comprovante, 'Certificado 2026/031');
    assert.equal(a.validado, 0);
    assert.equal(criada.dados.resumo.declarado, 2.5);
    assert.equal(criada.dados.resumo.validado, 0);
  });
});

test('dados inválidos na atividade são recusados com mensagem', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);

    const semHoras = await aluno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, horas: 0 } });
    assert.equal(semHoras.status, 400);
    assert.match(semHoras.dados.erro, /horas/i);

    const categoria = await aluno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, categoria: 'Futebol' } });
    assert.equal(categoria.status, 400);

    const dataRuim = await aluno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, data_atividade: '14/03/2026' } });
    assert.equal(dataRuim.status, 400);

    const fimAntes = await aluno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, data_fim: '2026-03-10' } });
    assert.equal(fimAntes.status, 400);
    assert.match(fimAntes.dados.erro, /término/i);
  });
});

test('validar move as horas, e editar depois derruba a validação', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 120);
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);
    const { dados } = await aluno('/api/atividades', { metodo: 'POST', corpo: atividadeBase });

    const validada = await professor(`/api/atividades/${dados.atividade.id}/validacao`, {
      metodo: 'POST',
      corpo: { validado: true, observacao: 'Bom detalhamento.' },
    });
    assert.equal(validada.status, 200);
    assert.equal(validada.dados.atividade.validado, 1);
    assert.equal((await aluno('/api/atividades')).dados.resumo.validado, 2.5);

    const editada = await aluno(`/api/atividades/${dados.atividade.id}`, {
      metodo: 'PUT',
      corpo: { ...atividadeBase, horas: 4, texto: 'Versão revisada.' },
    });
    assert.equal(editada.dados.atividade.validado, 0);
    assert.equal(editada.dados.resumo.declarado, 4);
    assert.equal(editada.dados.resumo.validado, 0);
  });
});

test('excluir atividade remove as horas do total', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);
    const { dados } = await aluno('/api/atividades', { metodo: 'POST', corpo: atividadeBase });

    const apagada = await aluno(`/api/atividades/${dados.atividade.id}`, { metodo: 'DELETE' });
    assert.equal(apagada.status, 200);
    assert.equal(apagada.dados.resumo.declarado, 0);
  });
});

// ---------------------------------------------------------------- isolamento entre professores

test('um professor não enxerga alunos, registros nem turmas de outro', async () => {
  await comAmbiente(async ({ base }) => {
    const marina = await criarProfessor(base);
    const carlos = await criarProfessor(base, 'Prof. Carlos', 'carlos@exemplo.br');
    const turmaMarina = await criarTurma(marina, 'Marina — manhã', 120);
    const turmaCarlos = await criarTurma(carlos, 'Carlos — noite', 300);

    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br', turmaMarina.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@exemplo.br', turmaCarlos.codigo);
    const daAna = await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    await bruno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, titulo: 'Do Bruno' } });

    const alunosMarina = await marina('/api/turma');
    assert.equal(alunosMarina.dados.alunos.length, 1);
    assert.equal(alunosMarina.dados.alunos[0].nome, 'Ana');
    assert.equal(alunosMarina.dados.turmas.length, 1);

    const registrosCarlos = await carlos('/api/atividades');
    assert.equal(registrosCarlos.dados.atividades.length, 1);
    assert.equal(registrosCarlos.dados.atividades[0].titulo, 'Do Bruno');

    // Carlos não valida atividade de aluno da Marina, nem edita a turma dela.
    const validacaoAlheia = await carlos(`/api/atividades/${daAna.dados.atividade.id}/validacao`, {
      metodo: 'POST',
      corpo: { validado: true },
    });
    assert.equal(validacaoAlheia.status, 404);

    const edicaoAlheia = await carlos(`/api/turmas/${turmaMarina.id}`, {
      metodo: 'PUT',
      corpo: { nome: 'Roubada', meta_horas: 10 },
    });
    assert.equal(edicaoAlheia.status, 404);

    const exclusaoAlheia = await carlos(`/api/turmas/${turmaMarina.id}`, { metodo: 'DELETE' });
    assert.equal(exclusaoAlheia.status, 404);

    const csvCarlos = await carlos('/api/exportar.csv');
    assert.match(csvCarlos.dados, /Do Bruno/);
    assert.doesNotMatch(csvCarlos.dados, /Observação livre no pátio/);
  });
});

test('o professor filtra alunos e registros por turma', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const manha = await criarTurma(professor, 'Manhã', 120);
    const noite = await criarTurma(professor, 'Noite', 200);
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br', manha.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@exemplo.br', noite.codigo);
    await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    await bruno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, titulo: 'Da noite' } });

    assert.equal((await professor('/api/turma')).dados.alunos.length, 2);

    const soManha = await professor(`/api/turma?turma_id=${manha.id}`);
    assert.equal(soManha.dados.alunos.length, 1);
    assert.equal(soManha.dados.alunos[0].meta, 120);

    const registrosNoite = await professor(`/api/atividades?turma_id=${noite.id}`);
    assert.equal(registrosNoite.dados.atividades.length, 1);
    assert.equal(registrosNoite.dados.atividades[0].turma_nome, 'Noite');

    const csvNoite = await professor(`/api/exportar.csv?turma_id=${noite.id}`);
    assert.match(csvNoite.dados, /Da noite/);
    assert.doesNotMatch(csvNoite.dados, /Observação livre no pátio/);
  });
});

test('aluno não valida horas nem mexe em atividade de colega', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@exemplo.br', turma.codigo);
    const { dados } = await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });

    assert.equal((await ana(`/api/atividades/${dados.atividade.id}/validacao`, { metodo: 'POST', corpo: { validado: true } })).status, 403);
    assert.equal((await bruno(`/api/atividades/${dados.atividade.id}`, { metodo: 'PUT', corpo: atividadeBase })).status, 403);
    assert.equal((await bruno(`/api/atividades/${dados.atividade.id}`, { metodo: 'DELETE' })).status, 403);
    assert.equal((await bruno('/api/atividades')).dados.atividades.length, 0);
    assert.equal((await ana('/api/turmas', { metodo: 'POST', corpo: { nome: 'X', meta_horas: 10 } })).status, 403);
  });
});

test('turma com aluno não é excluída por engano', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);
    const recusa = await professor(`/api/turmas/${turma.id}`, { metodo: 'DELETE' });
    assert.equal(recusa.status, 409);
    assert.match(recusa.dados.erro, /aluno/i);
  });
});

test('o aluno troca de turma digitando outro código', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const errada = await criarTurma(professor, 'Turma errada', 300);
    const certa = await criarTurma(professor, 'Turma certa', 90);
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br', errada.codigo);
    assert.equal((await ana('/api/eu')).dados.resumo.meta, 300);

    const troca = await ana('/api/eu', {
      metodo: 'PUT',
      corpo: { nome: 'Ana Ribeiro', codigo_turma: certa.codigo, matricula: '2026042' },
    });
    assert.equal(troca.status, 200);
    assert.equal(troca.dados.resumo.meta, 90);

    const eu = await ana('/api/eu');
    assert.equal(eu.dados.usuario.turma_nome, 'Turma certa');
    assert.equal(eu.dados.usuario.nome, 'Ana Ribeiro');
    assert.equal(eu.dados.usuario.matricula, '2026042');
  });
});

test('o professor edita o próprio nome e instituição', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const r = await professor('/api/eu', {
      metodo: 'PUT',
      corpo: { nome: 'Profa. Marina Alves', instituicao: 'Psicologia — UniExemplo' },
    });
    assert.equal(r.status, 200);
    const eu = await professor('/api/eu');
    assert.equal(eu.dados.usuario.nome, 'Profa. Marina Alves');
    assert.equal(eu.dados.usuario.instituicao, 'Psicologia — UniExemplo');
  });
});

// ---------------------------------------------------------------- geral

test('sem sessão, as rotas protegidas respondem 401', async () => {
  await comAmbiente(async ({ base }) => {
    const anonimo = cliente(base);
    assert.equal((await anonimo('/api/atividades')).status, 401);
    assert.equal((await anonimo('/api/atividades', { metodo: 'POST', corpo: atividadeBase })).status, 401);
    assert.equal((await anonimo('/api/turma')).status, 401);
    assert.equal((await anonimo('/api/turmas')).status, 401);
    assert.equal((await anonimo('/api/eu')).dados.usuario, null);
  });
});

test('a exportação do aluno traz só os registros dele, com as colunas da ficha', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo, { matricula: '2026001' });
    const bruno = await criarAluno(base, 'Bruno', 'bruno@exemplo.br', turma.codigo);
    await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    await bruno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, titulo: 'Do Bruno' } });

    const csv = await ana('/api/exportar.csv');
    const linhas = csv.dados.trim().split('\r\n');
    assert.equal(linhas.length, 2);
    assert.match(linhas[0], /aluno;matricula;turma;data_inicio;data_fim;atividade/);
    assert.match(csv.dados, /2026001/);
    assert.doesNotMatch(csv.dados, /Do Bruno/);
  });
});

test('a página inicial é servida e caminhos desconhecidos devolvem 404', async () => {
  await comAmbiente(async ({ base }) => {
    const anonimo = cliente(base);
    const pagina = await anonimo('/');
    assert.equal(pagina.status, 200);
    assert.match(pagina.dados, /Horas Complementares/);
    assert.equal((await anonimo('/nao-existe.html')).status, 404);
  });
});
