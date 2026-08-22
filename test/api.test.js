import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoLocal } from '../src/sqlite.js';
import { criarServidor } from '../server.js';

process.env.CODIGO_PROFESSOR = process.env.CODIGO_PROFESSOR || 'tecnicas-de-observacao';

async function subirServidor() {
  const bd = bancoLocal(':memory:');
  const servidor = criarServidor(bd);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { servidor, base, fechar: () => new Promise((r) => servidor.close(r)) };
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

const atividadeBase = {
  titulo: 'Observação livre no pátio',
  categoria: 'Observação em campo',
  data_atividade: '2026-03-14',
  horas: 2.5,
  texto: 'Registro cursivo do terceiro encontro. Duas crianças em brincadeira paralela.',
};

async function comAmbiente(fn) {
  const ambiente = await subirServidor();
  try {
    await fn(ambiente);
  } finally {
    await ambiente.fechar();
  }
}

const criarAluno = async (base, nome, email) => {
  const c = cliente(base);
  const r = await c('/api/cadastro', { metodo: 'POST', corpo: { nome, email, senha: 'senha123' } });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return c;
};

const criarProfessor = async (base) => {
  const c = cliente(base);
  const r = await c('/api/cadastro', {
    metodo: 'POST',
    corpo: {
      nome: 'Profa. Marina',
      email: 'marina@exemplo.br',
      senha: 'senha123',
      codigo_professor: process.env.CODIGO_PROFESSOR,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return c;
};

test('cadastro cria aluno e sessão, e o login devolve o mesmo usuário', async () => {
  await comAmbiente(async ({ base }) => {
    const aluno = await criarAluno(base, 'Ana Ribeiro', 'ana@exemplo.br');
    const eu = await aluno('/api/eu');
    assert.equal(eu.dados.usuario.papel, 'aluno');
    assert.equal(eu.dados.usuario.nome, 'Ana Ribeiro');
    assert.equal(eu.dados.resumo.declarado, 0);

    const outro = cliente(base);
    const login = await outro('/api/login', {
      metodo: 'POST',
      corpo: { email: 'ana@exemplo.br', senha: 'senha123' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.dados.usuario.email, 'ana@exemplo.br');

    const errado = await outro('/api/login', {
      metodo: 'POST',
      corpo: { email: 'ana@exemplo.br', senha: 'errada' },
    });
    assert.equal(errado.status, 401);
  });
});

test('e-mail duplicado e código de professor errado são recusados', async () => {
  await comAmbiente(async ({ base }) => {
    await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const c = cliente(base);
    const repetido = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { nome: 'Outra Ana', email: 'ana@exemplo.br', senha: 'senha123' },
    });
    assert.equal(repetido.status, 409);

    const falso = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { nome: 'Falso', email: 'falso@exemplo.br', senha: 'senha123', codigo_professor: 'xxx' },
    });
    assert.equal(falso.status, 400);
  });
});

test('atividade registrada entra no total declarado e fica aguardando validação', async () => {
  await comAmbiente(async ({ base }) => {
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const criada = await aluno('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    assert.equal(criada.status, 201);
    assert.equal(criada.dados.atividade.validado, 0);
    assert.equal(criada.dados.resumo.declarado, 2.5);
    assert.equal(criada.dados.resumo.validado, 0);
    assert.equal(criada.dados.resumo.pendentes, 1);

    const lista = await aluno('/api/atividades');
    assert.equal(lista.dados.atividades.length, 1);
    assert.equal(lista.dados.atividades[0].texto, atividadeBase.texto);
  });
});

test('validação do professor move as horas para o total validado', async () => {
  await comAmbiente(async ({ base }) => {
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const professor = await criarProfessor(base);
    const { dados } = await aluno('/api/atividades', { metodo: 'POST', corpo: atividadeBase });

    const validada = await professor(`/api/atividades/${dados.atividade.id}/validacao`, {
      metodo: 'POST',
      corpo: { validado: true, observacao: 'Bom detalhamento do registro.' },
    });
    assert.equal(validada.status, 200);
    assert.equal(validada.dados.atividade.validado, 1);
    assert.equal(validada.dados.atividade.validado_por_nome, 'Profa. Marina');

    const depois = await aluno('/api/atividades');
    assert.equal(depois.dados.resumo.validado, 2.5);
    assert.equal(depois.dados.resumo.pendentes, 0);
    assert.equal(depois.dados.atividades[0].observacao, 'Bom detalhamento do registro.');

    const turma = await professor('/api/turma');
    assert.equal(turma.dados.alunos.length, 1);
    assert.equal(turma.dados.alunos[0].validado, 2.5);
    assert.equal(turma.dados.alunos[0].declarado, 2.5);
  });
});

test('editar uma atividade validada derruba a validação', async () => {
  await comAmbiente(async ({ base }) => {
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const professor = await criarProfessor(base);
    const { dados } = await aluno('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    await professor(`/api/atividades/${dados.atividade.id}/validacao`, {
      metodo: 'POST',
      corpo: { validado: true },
    });

    const editada = await aluno(`/api/atividades/${dados.atividade.id}`, {
      metodo: 'PUT',
      corpo: { ...atividadeBase, horas: 4, texto: 'Versão revisada da análise.' },
    });
    assert.equal(editada.status, 200);
    assert.equal(editada.dados.atividade.validado, 0);
    assert.equal(editada.dados.resumo.declarado, 4);
    assert.equal(editada.dados.resumo.validado, 0);
  });
});

test('aluno não valida horas nem mexe em atividade de colega', async () => {
  await comAmbiente(async ({ base }) => {
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const bruno = await criarAluno(base, 'Bruno', 'bruno@exemplo.br');
    const { dados } = await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });

    const tentativa = await ana(`/api/atividades/${dados.atividade.id}/validacao`, {
      metodo: 'POST',
      corpo: { validado: true },
    });
    assert.equal(tentativa.status, 403);

    const edicaoAlheia = await bruno(`/api/atividades/${dados.atividade.id}`, {
      metodo: 'PUT',
      corpo: atividadeBase,
    });
    assert.equal(edicaoAlheia.status, 403);

    const exclusaoAlheia = await bruno(`/api/atividades/${dados.atividade.id}`, { metodo: 'DELETE' });
    assert.equal(exclusaoAlheia.status, 403);

    const listaBruno = await bruno('/api/atividades');
    assert.equal(listaBruno.dados.atividades.length, 0);
  });
});

test('sem sessão, as rotas de atividade respondem 401', async () => {
  await comAmbiente(async ({ base }) => {
    const anonimo = cliente(base);
    assert.equal((await anonimo('/api/atividades')).status, 401);
    assert.equal((await anonimo('/api/atividades', { metodo: 'POST', corpo: atividadeBase })).status, 401);
    assert.equal((await anonimo('/api/turma')).status, 401);
    assert.equal((await anonimo('/api/eu')).dados.usuario, null);
  });
});

test('dados inválidos são recusados com mensagem', async () => {
  await comAmbiente(async ({ base }) => {
    const aluno = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const semHoras = await aluno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, horas: 0 } });
    assert.equal(semHoras.status, 400);
    assert.match(semHoras.dados.erro, /horas/i);

    const categoriaInvalida = await aluno('/api/atividades', {
      metodo: 'POST',
      corpo: { ...atividadeBase, categoria: 'Futebol' },
    });
    assert.equal(categoriaInvalida.status, 400);

    const dataInvalida = await aluno('/api/atividades', {
      metodo: 'POST',
      corpo: { ...atividadeBase, data_atividade: '14/03/2026' },
    });
    assert.equal(dataInvalida.status, 400);
  });
});

test('professor ajusta a meta e enxerga todos os registros; aluno não muda a meta', async () => {
  await comAmbiente(async ({ base }) => {
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const bruno = await criarAluno(base, 'Bruno', 'bruno@exemplo.br');
    const professor = await criarProfessor(base);
    await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    await bruno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, horas: 3 } });

    const todos = await professor('/api/atividades');
    assert.equal(todos.dados.atividades.length, 2);

    const negado = await ana('/api/config', { metodo: 'PUT', corpo: { meta_horas: 10 } });
    assert.equal(negado.status, 403);

    const ajuste = await professor('/api/config', {
      metodo: 'PUT',
      corpo: { meta_horas: 120, titulo_turma: 'Psicologia 4º período' },
    });
    assert.equal(ajuste.dados.meta_horas, 120);
    const eu = await ana('/api/eu');
    assert.equal(eu.dados.resumo.meta, 120);
    assert.equal(eu.dados.titulo_turma, 'Psicologia 4º período');
  });
});

test('exportação em CSV traz uma linha por atividade', async () => {
  await comAmbiente(async ({ base }) => {
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const professor = await criarProfessor(base);
    await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    await ana('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, titulo: 'Segunda saída' } });

    const csv = await professor('/api/exportar.csv');
    assert.equal(csv.status, 200);
    const linhas = csv.dados.trim().split('\r\n');
    assert.equal(linhas.length, 3);
    assert.match(linhas[0], /aluno;data;titulo/);
    assert.match(csv.dados, /Observação livre no pátio/);
  });
});

test('excluir atividade remove as horas do total', async () => {
  await comAmbiente(async ({ base }) => {
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    const { dados } = await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    const apagada = await ana(`/api/atividades/${dados.atividade.id}`, { metodo: 'DELETE' });
    assert.equal(apagada.status, 200);
    assert.equal(apagada.dados.resumo.declarado, 0);
    assert.equal((await ana('/api/atividades')).dados.atividades.length, 0);
  });
});

test('logout encerra a sessão', async () => {
  await comAmbiente(async ({ base }) => {
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br');
    assert.equal((await ana('/api/logout', { metodo: 'POST' })).status, 200);
    assert.equal((await ana('/api/eu')).dados.usuario, null);
    assert.equal((await ana('/api/atividades')).status, 401);
  });
});

test('a página inicial é servida e caminhos desconhecidos devolvem 404', async () => {
  await comAmbiente(async ({ base }) => {
    const anonimo = cliente(base);
    const pagina = await anonimo('/');
    assert.equal(pagina.status, 200);
    assert.match(pagina.dados, /Horas complementares/);
    assert.equal((await anonimo('/nao-existe.html')).status, 404);
  });
});
