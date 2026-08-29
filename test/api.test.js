import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoLocal } from '../src/sqlite.js';
import { armazenamentoD1 } from '../src/arquivos.js';
import { criarServidor } from '../server.js';

async function subirServidor() {
  const bd = bancoLocal(':memory:');
  // Guarda os arquivos no próprio banco em memória: é o mesmo destino que a
  // produção usa enquanto não houver bucket R2.
  const servidor = criarServidor(bd, { arquivos: armazenamentoD1(bd) });
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
    if (tipo.includes('json')) return { status: resposta.status, dados: await resposta.json() };
    // Conteúdo binário volta como bytes: comparar texto esconderia troca de
    // ordem entre as partes de um arquivo fatiado.
    const binario = !tipo.startsWith('text/') && !tipo.includes('html');
    return {
      status: resposta.status,
      tipo,
      cabecalhos: Object.fromEntries(resposta.headers),
      dados: binario ? Buffer.from(await resposta.arrayBuffer()) : await resposta.text(),
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

// A primeira conta de equipe da faculdade entra sem convite e já como admin.
async function criarProfessor(base, nome = 'Profa. Marina', email = 'marina@exemplo.br', codigoConvite = null) {
  const c = cliente(base);
  const r = await c('/api/cadastro', {
    metodo: 'POST',
    corpo: {
      papel: 'professor', nome, email, senha: 'senha123',
      instituicao: 'UniExemplo', codigo_convite: codigoConvite,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return c;
}

async function gerarConvite(convidador, observacao = null) {
  const r = await convidador('/api/convites', { metodo: 'POST', corpo: { observacao } });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return r.dados.convite.codigo;
}

// Professor seguinte só entra com convite de quem já está dentro.
const criarProfessorConvidado = async (base, convidador, nome, email) =>
  criarProfessor(base, nome, email, await gerarConvite(convidador, nome));

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

test('a primeira conta da faculdade vira admin e a turma nasce com um código', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const turma = await criarTurma(admin, 'Técnicas de Observação', 120, '2026.1');
    assert.match(turma.codigo, /^[A-Z0-9]{6}$/);

    const eu = await admin('/api/eu');
    assert.equal(eu.dados.usuario.papel, 'admin');
    assert.equal(eu.dados.usuario.instituicao, 'UniExemplo');
    assert.equal(eu.dados.turmas.length, 1);
    assert.equal(eu.dados.cursos.length, 0, 'instalação nova não inventa curso');
    assert.ok(eu.dados.categorias.length >= 8);

    // Quem entra por convite depois começa como professor.
    const professora = await criarProfessorConvidado(base, admin, 'Profa. Helena', 'helena@exemplo.br');
    assert.equal((await professora('/api/eu')).dados.usuario.papel, 'professor');
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
    assert.equal(eu.dados.materias[0].professor_nome, 'Profa. Marina');
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
    const marina = await criarProfessor(base);
    const c = cliente(base);

    const repetido = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: {
        papel: 'professor', nome: 'Outra', email: 'marina@exemplo.br',
        senha: 'senha123', codigo_convite: await gerarConvite(marina),
      },
    });
    assert.equal(repetido.status, 409);

    const curta = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: {
        papel: 'professor', nome: 'Z', email: 'z@exemplo.br',
        senha: '123', codigo_convite: await gerarConvite(marina),
      },
    });
    assert.equal(curta.status, 400);
  });
});

test('depois do primeiro, criar conta de professor exige convite válido', async () => {
  await comAmbiente(async ({ base }) => {
    const marina = await criarProfessor(base);
    const c = cliente(base);

    const semConvite = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'professor', nome: 'Intruso', email: 'intruso@exemplo.br', senha: 'senha123' },
    });
    assert.equal(semConvite.status, 400);
    assert.match(semConvite.dados.erro, /convite/i);

    const codigoErrado = await c('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'professor', nome: 'Intruso', email: 'intruso@exemplo.br', senha: 'senha123', codigo_convite: 'ZZZZZZZZZZ' },
    });
    assert.equal(codigoErrado.status, 404);

    // Aluno segue entrando sem convite nenhum, só com o código da turma.
    const turma = await criarTurma(marina, 'Manhã');
    await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);
  });
});

test('convite vale uma vez só e pode ser revogado enquanto não foi usado', async () => {
  await comAmbiente(async ({ base }) => {
    const marina = await criarProfessor(base);
    const codigo = await gerarConvite(marina, 'Profa. Helena');
    await criarProfessor(base, 'Profa. Helena', 'helena@exemplo.br', codigo);

    const segundaVez = await cliente(base)('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'professor', nome: 'Outro', email: 'outro@exemplo.br', senha: 'senha123', codigo_convite: codigo },
    });
    assert.equal(segundaVez.status, 409);
    assert.match(segundaVez.dados.erro, /já foi usado/i);

    const lista = await marina('/api/convites');
    assert.equal(lista.dados.convites.length, 1);
    assert.equal(lista.dados.convites[0].usado_por_nome, 'Profa. Helena');
    assert.equal(lista.dados.convites[0].observacao, 'Profa. Helena');

    // O usado não some; um novo, ainda livre, pode ser revogado.
    const usado = lista.dados.convites[0].id;
    assert.equal((await marina(`/api/convites/${usado}`, { metodo: 'DELETE' })).status, 409);

    const livre = await gerarConvite(marina);
    const idLivre = (await marina('/api/convites')).dados.convites[0].id;
    assert.equal((await marina(`/api/convites/${idLivre}`, { metodo: 'DELETE' })).status, 200);

    const revogado = await cliente(base)('/api/cadastro', {
      metodo: 'POST',
      corpo: { papel: 'professor', nome: 'Tarde', email: 'tarde@exemplo.br', senha: 'senha123', codigo_convite: livre },
    });
    assert.equal(revogado.status, 404);
  });
});

test('quem entrou por convite não convida outros, e aluno nem enxerga a rota', async () => {
  await comAmbiente(async ({ base }) => {
    const marina = await criarProfessor(base);
    const helena = await criarProfessorConvidado(base, marina, 'Profa. Helena', 'helena@exemplo.br');

    assert.equal((await helena('/api/convites')).status, 403);
    assert.equal((await helena('/api/convites', { metodo: 'POST', corpo: {} })).status, 403);
    assert.equal((await helena('/api/eu')).dados.usuario.pode_convidar, 0);
    assert.equal((await marina('/api/eu')).dados.usuario.pode_convidar, 1);

    const turma = await criarTurma(marina, 'Manhã');
    const ana = await criarAluno(base, 'Ana', 'ana@exemplo.br', turma.codigo);
    assert.equal((await ana('/api/convites')).status, 403);

    // Cada convite só aparece para quem o criou.
    assert.equal((await marina('/api/convites')).dados.convites.length, 1);
  });
});

test('a tela de cadastro sabe se o convite é obrigatório', async () => {
  await comAmbiente(async ({ base }) => {
    const anonimo = cliente(base);
    assert.equal((await anonimo('/api/eu')).dados.convite_obrigatorio, false);
    await criarProfessor(base);
    assert.equal((await anonimo('/api/eu')).dados.convite_obrigatorio, true);
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

    const validada = await professor(`/api/atividades/${dados.atividade.id}/analise`, {
      metodo: 'POST',
      corpo: { status: 'aprovado', motivo: 'Bom detalhamento.' },
    });
    assert.equal(validada.status, 200);
    assert.equal(validada.dados.atividade.status, 'aprovado');
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
    const admin = await criarProfessor(base);
    const marina = await criarProfessorConvidado(base, admin, 'Profa. Marina P.', 'marina.p@exemplo.br');
    const carlos = await criarProfessorConvidado(base, admin, 'Prof. Carlos', 'carlos@exemplo.br');
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

    // O admin da faculdade enxerga as duas turmas.
    const visaoAdmin = await admin('/api/turma');
    assert.equal(visaoAdmin.dados.alunos.length, 2);
    assert.equal(visaoAdmin.dados.turmas.length, 2);
    assert.equal((await admin('/api/atividades')).dados.atividades.length, 2);
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

    assert.equal((await ana(`/api/atividades/${dados.atividade.id}/analise`, { metodo: 'POST', corpo: { status: 'aprovado' } })).status, 403);
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
    const admin = await criarProfessor(base);
    const professor = await criarProfessorConvidado(base, admin, 'Prof. Novo', 'novo@exemplo.br');
    const r = await professor('/api/eu', {
      metodo: 'PUT',
      corpo: { nome: 'Profa. Marina Alves', instituicao: 'Psicologia — UniExemplo' },
    });
    assert.equal(r.status, 200);
    const eu = await professor('/api/eu');
    assert.equal(eu.dados.usuario.nome, 'Profa. Marina Alves');
    assert.equal(eu.dados.usuario.instituicao, 'Psicologia — UniExemplo');
    assert.equal(eu.dados.usuario.papel, 'professor');
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
    assert.match(pagina.dados, /Sala de Aula/);
    assert.equal((await anonimo('/nao-existe.html')).status, 404);
  });
});

// ---------------------------------------------------------------- integração

async function criarChave(professor, nome = 'Sistema de Exercícios') {
  const r = await professor('/api/chaves', { metodo: 'POST', corpo: { nome } });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  assert.match(r.dados.token, /^hc_[A-Z0-9]{8}_[A-Z0-9]{32}$/);
  return r.dados.token;
}

function integracao(base, token) {
  return async (corpo) => {
    const resposta = await fetch(`${base}/api/integracao/atividades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo),
    });
    return { status: resposta.status, dados: await resposta.json() };
  };
}

const loteBase = (codigo, extras = {}) => ({
  turma_codigo: codigo,
  atividades: [{
    origem_id: 'exerc-2026-001',
    aluno: { email: 'ana@ex.br', matricula: '2026001', nome: 'Ana Ribeiro' },
    titulo: 'Exercício 3 — registro cursivo',
    categoria: 'Registro cursivo',
    data_atividade: '2026-04-10',
    horas: 2,
    texto: 'Entregue pelo sistema de exercícios.',
    ...extras,
  }],
});

test('a importação cria o aluno que ainda não tem conta e lança as horas', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 120);
    const enviar = integracao(base, await criarChave(professor));

    const r = await enviar(loteBase(turma.codigo));
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.deepEqual(
      { criadas: r.dados.criadas, atualizadas: r.dados.atualizadas, erros: r.dados.erros, alunos: r.dados.alunos_criados },
      { criadas: 1, atualizadas: 0, erros: 0, alunos: 1 },
    );

    const painel = await professor('/api/turma');
    assert.equal(painel.dados.alunos.length, 1);
    assert.equal(painel.dados.alunos[0].nome, 'Ana Ribeiro');
    assert.equal(painel.dados.alunos[0].declarado, 2);
    assert.equal(painel.dados.alunos[0].pendentes, 1);
  });
});

test('reenviar o mesmo origem_id atualiza em vez de duplicar', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const enviar = integracao(base, await criarChave(professor));

    await enviar(loteBase(turma.codigo));
    const segunda = await enviar(loteBase(turma.codigo, { horas: 5, titulo: 'Exercício 3 — versão corrigida' }));
    assert.equal(segunda.dados.criadas, 0);
    assert.equal(segunda.dados.atualizadas, 1);

    const registros = await professor('/api/atividades');
    assert.equal(registros.dados.atividades.length, 1);
    assert.equal(registros.dados.atividades[0].horas, 5);
    assert.equal(registros.dados.atividades[0].titulo, 'Exercício 3 — versão corrigida');
  });
});

test('a origem pode mandar a atividade já validada', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 100);
    const enviar = integracao(base, await criarChave(professor));

    await enviar(loteBase(turma.codigo, { validado: true, observacao: 'Corrigido automaticamente.' }));
    const painel = await professor('/api/turma');
    assert.equal(painel.dados.alunos[0].validado, 2);
    assert.equal(painel.dados.alunos[0].pendentes, 0);
  });
});

test('o aluno pré-cadastrado assume a conta e mantém as horas importadas', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã', 120);
    const enviar = integracao(base, await criarChave(professor));
    await enviar(loteBase(turma.codigo));

    // Antes de assumir, a conta não entra por senha.
    const tentativa = await cliente(base)('/api/login', {
      metodo: 'POST',
      corpo: { email: 'ana@ex.br', senha: 'senha123' },
    });
    assert.equal(tentativa.status, 401);
    assert.match(tentativa.dados.erro, /importação/i);

    const ana = await criarAluno(base, 'Ana Ribeiro', 'ana@ex.br', turma.codigo, { matricula: '2026001' });
    const eu = await ana('/api/eu');
    assert.equal(eu.dados.usuario.turma_nome, 'Manhã');
    assert.equal(eu.dados.resumo.declarado, 2);
    assert.equal(eu.dados.resumo.meta, 120);

    const minhas = await ana('/api/atividades');
    assert.equal(minhas.dados.atividades.length, 1);
    assert.equal(minhas.dados.atividades[0].titulo, 'Exercício 3 — registro cursivo');
  });
});

test('um item inválido não derruba o lote inteiro', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const enviar = integracao(base, await criarChave(professor));

    const r = await enviar({
      turma_codigo: turma.codigo,
      atividades: [
        loteBase(turma.codigo).atividades[0],
        { origem_id: 'ruim-1', aluno: { email: 'bruno@ex.br' }, titulo: 'Sem horas', categoria: 'Outro', data_atividade: '2026-04-10', horas: 0 },
        { origem_id: 'ruim-2', aluno: {}, titulo: 'Sem aluno', categoria: 'Outro', data_atividade: '2026-04-10', horas: 1 },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.dados.criadas, 1);
    assert.equal(r.dados.erros, 2);
    assert.equal(r.dados.resultados[1].status, 'erro');
    assert.match(r.dados.resultados[1].motivo, /horas/i);
    assert.match(r.dados.resultados[2].motivo, /e-mail ou a matrícula/i);
  });
});

test('chave inválida, revogada ou de outro professor não importa nada', async () => {
  await comAmbiente(async ({ base }) => {
    const marina = await criarProfessor(base);
    const carlos = await criarProfessorConvidado(base, marina, 'Prof. Carlos', 'carlos@exemplo.br');
    const turmaMarina = await criarTurma(marina, 'Marina', 120);
    const chaveCarlos = await criarChave(carlos, 'Sistema do Carlos');

    assert.equal((await integracao(base, 'hc_XXXXXXXX_YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY')(loteBase(turmaMarina.codigo))).status, 401);
    assert.equal((await integracao(base, 'lixo')(loteBase(turmaMarina.codigo))).status, 401);

    // A chave é válida, mas a turma é de outro professor.
    const alheia = await integracao(base, chaveCarlos)(loteBase(turmaMarina.codigo));
    assert.equal(alheia.status, 404);

    const chaveMarina = await criarChave(marina);
    const lista = await marina('/api/chaves');
    assert.equal(lista.dados.chaves.length, 1);
    assert.equal((await marina(`/api/chaves/${lista.dados.chaves[0].id}`, { metodo: 'DELETE' })).status, 200);
    assert.equal((await integracao(base, chaveMarina)(loteBase(turmaMarina.codigo))).status, 401);
  });
});

test('aluno não cria chaves de integração', async () => {
  await comAmbiente(async ({ base }) => {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', turma.codigo);
    assert.equal((await ana('/api/chaves')).status, 403);
    assert.equal((await ana('/api/chaves', { metodo: 'POST', corpo: { nome: 'X' } })).status, 403);
  });
});

// ---------------------------------------------------------------- estrutura acadêmica

async function criarCurso(admin, nome, horas_obrigatorias, sigla = null) {
  const r = await admin('/api/cursos', { metodo: 'POST', corpo: { nome, horas_obrigatorias, sigla } });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  return r.dados.curso;
}

const idCategoria = async (usuario, nome) => {
  const { dados } = await usuario('/api/categorias');
  const achada = dados.categorias.find((c) => c.nome === nome);
  assert.ok(achada, `categoria ${nome} deveria existir`);
  return achada.id;
};

test('o admin cria curso com carga obrigatória e o aluno herda essa meta', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const curso = await criarCurso(admin, 'Psicologia', 100, 'PSI');

    const r = await admin('/api/turmas', {
      metodo: 'POST',
      corpo: { nome: 'Técnicas de Observação', curso_id: curso.id, meta_horas: 100 },
    });
    const turma = r.dados.turma;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', turma.codigo);
    await admin('/api/usuarios/' + (await admin('/api/usuarios')).dados.usuarios.find((u) => u.email === 'ana@ex.br').id, {
      metodo: 'PUT',
      corpo: { papel: 'aluno', curso_id: curso.id, semestre: '4º' },
    });

    const eu = await ana('/api/eu');
    assert.equal(eu.dados.resumo.meta, 100, 'a carga vem do curso');
    assert.equal(eu.dados.curso.nome, 'Psicologia');
  });
});

test('as regras de categoria por curso aparecem no painel do aluno', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const curso = await criarCurso(admin, 'Psicologia', 100);
    const campo = await idCategoria(admin, 'Observação em campo');
    const leitura = await idCategoria(admin, 'Leitura / fichamento');

    const regras = await admin(`/api/cursos/${curso.id}/regras`, {
      metodo: 'PUT',
      corpo: {
        regras: [
          { categoria_id: campo, limite_horas: 40 },
          { categoria_id: leitura, percentual_max: 20 },
        ],
      },
    });
    assert.equal(regras.status, 200, JSON.stringify(regras.dados));

    const { dados } = await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: 'Manhã', curso_id: curso.id },
    });
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', dados.turma.codigo);
    const anaId = (await admin('/api/usuarios')).dados.usuarios.find((u) => u.email === 'ana@ex.br').id;
    await admin(`/api/usuarios/${anaId}`, { metodo: 'PUT', corpo: { curso_id: curso.id } });

    await ana('/api/atividades', {
      metodo: 'POST',
      corpo: { ...atividadeBase, categoria: 'Observação em campo', horas: 6 },
    });

    const eu = await ana('/api/eu');
    const emCampo = eu.dados.resumo.categorias.find((c) => c.nome === 'Observação em campo');
    const emLeitura = eu.dados.resumo.categorias.find((c) => c.nome === 'Leitura / fichamento');
    assert.equal(emCampo.limite, 40, 'limite em horas');
    assert.equal(emCampo.declarado, 6);
    assert.equal(emLeitura.limite, 20, '20% de 100h = 20h');
  });
});

test('o aluno que entra pelo código herda o curso da turma e os limites dele', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const curso = await criarCurso(admin, 'Psicologia', 100);
    const campo = await idCategoria(admin, 'Observação em campo');
    await admin(`/api/cursos/${curso.id}/regras`, {
      metodo: 'PUT', corpo: { regras: [{ categoria_id: campo, limite_horas: 40 }] },
    });
    const turma = (await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: 'Manhã', curso_id: curso.id },
    })).dados.turma;

    // Sem passar por nenhuma tela de admin: só o código da turma.
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', turma.codigo);
    const eu = await ana('/api/eu');
    assert.equal(eu.dados.curso.nome, 'Psicologia');
    assert.equal(eu.dados.resumo.meta, 100);
    assert.equal(eu.dados.resumo.categorias.find((c) => c.nome === 'Observação em campo').limite, 40);
  });
});

test('o coordenador enxerga os cursos que coordena, e nada além', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const psico = await criarCurso(admin, 'Psicologia', 100);
    const direito = await criarCurso(admin, 'Direito', 200);

    const helena = await criarProfessorConvidado(base, admin, 'Profa. Helena', 'helena@exemplo.br');
    const rafael = await criarProfessorConvidado(base, admin, 'Prof. Rafael', 'rafael@exemplo.br');
    const helenaId = (await admin('/api/usuarios')).dados.usuarios.find((u) => u.email === 'helena@exemplo.br').id;

    // Turmas de professores diferentes, em cursos diferentes.
    const tPsico = (await helena('/api/turmas', { metodo: 'POST', corpo: { nome: 'Psico — manhã', curso_id: psico.id } })).dados.turma;
    const tDireito = (await rafael('/api/turmas', { metodo: 'POST', corpo: { nome: 'Direito — noite', curso_id: direito.id } })).dados.turma;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', tPsico.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', tDireito.codigo);
    await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    await bruno('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, titulo: 'Do Direito' } });

    // Rafael continua professor; Helena vira coordenadora de Psicologia.
    const promovida = await admin(`/api/cursos/${psico.id}/coordenadores`, {
      metodo: 'POST', corpo: { usuario_id: helenaId },
    });
    assert.equal(promovida.status, 200, JSON.stringify(promovida.dados));
    assert.equal((await helena('/api/eu')).dados.usuario.papel, 'coordenador');

    // Como coordenadora, ela vê a turma de Psicologia mesmo não sendo dela.
    const outraTurmaPsico = (await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: 'Psico — noite', curso_id: psico.id },
    })).dados.turma;
    const carla = await criarAluno(base, 'Carla', 'carla@ex.br', outraTurmaPsico.codigo);
    await carla('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, titulo: 'Da Carla' } });

    const visao = await helena('/api/turma');
    assert.deepEqual(visao.dados.alunos.map((a) => a.nome).sort(), ['Ana', 'Carla']);
    const registros = await helena('/api/atividades');
    assert.equal(registros.dados.atividades.length, 2);
    assert.doesNotMatch(JSON.stringify(registros.dados), /Do Direito/);

    // E valida atividade de turma que não é dela, por ser do curso dela.
    const daCarla = registros.dados.atividades.find((a) => a.titulo === 'Da Carla');
    assert.equal((await helena(`/api/atividades/${daCarla.id}/analise`, {
      metodo: 'POST', corpo: { status: 'aprovado' },
    })).status, 200);

    // Rafael, professor, não alcança nada de Psicologia.
    const visaoRafael = await rafael('/api/turma');
    assert.deepEqual(visaoRafael.dados.alunos.map((a) => a.nome), ['Bruno']);
    assert.equal((await rafael(`/api/atividades/${daCarla.id}/analise`, {
      metodo: 'POST', corpo: { status: 'aprovado' },
    })).status, 404);
  });
});

test('só o admin mexe em cursos e categorias', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const professor = await criarProfessorConvidado(base, admin, 'Prof. Novo', 'novo@exemplo.br');
    const curso = await criarCurso(admin, 'Psicologia', 100);

    assert.equal((await professor('/api/cursos', { metodo: 'POST', corpo: { nome: 'X', horas_obrigatorias: 10 } })).status, 403);
    assert.equal((await professor(`/api/cursos/${curso.id}`, { metodo: 'PUT', corpo: { nome: 'X', horas_obrigatorias: 10 } })).status, 403);
    assert.equal((await professor('/api/categorias', { metodo: 'POST', corpo: { nome: 'Nova' } })).status, 403);
    assert.equal((await professor(`/api/cursos/${curso.id}/regras`, { metodo: 'PUT', corpo: { regras: [] } })).status, 403);
    // Mas ele consegue ler o que precisa para trabalhar.
    assert.equal((await professor('/api/cursos')).status, 200);
    assert.equal((await professor('/api/categorias')).status, 200);
  });
});

test('categoria nova entra no formulário; categoria usada é desativada, não apagada', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const nova = await admin('/api/categorias', {
      metodo: 'POST',
      corpo: { nome: 'Monitoria', descricao: 'Monitoria de disciplina', ordem: 5 },
    });
    assert.equal(nova.status, 201);

    const turma = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: 'Manhã' } })).dados.turma;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', turma.codigo);
    const criada = await ana('/api/atividades', {
      metodo: 'POST',
      corpo: { ...atividadeBase, categoria: 'Monitoria', horas: 3 },
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.dados));
    assert.equal(criada.dados.atividade.categoria, 'Monitoria');

    const apagar = await admin(`/api/categorias/${nova.dados.categoria.id}`, { metodo: 'DELETE' });
    assert.equal(apagar.dados.desativada, true);
    assert.equal(apagar.dados.atividades, 1);

    const restantes = await admin('/api/categorias');
    assert.equal(restantes.dados.categorias.find((c) => c.nome === 'Monitoria').ativa, 0);
    // O histórico do aluno continua de pé.
    assert.equal((await ana('/api/atividades')).dados.atividades[0].categoria, 'Monitoria');
  });
});

test('categoria inexistente é recusada no lançamento', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const turma = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: 'Manhã' } })).dados.turma;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', turma.codigo);
    const r = await ana('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, categoria: 'Futebol' } });
    assert.equal(r.status, 400);
    assert.match(r.dados.erro, /Categoria inválida/);
  });
});

// ---------------------------------------------------------------- aulas e entregas

const PDF_MINIMO = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>').toString('base64');
const arquivoExemplo = (nome = 'roteiro.pdf') => ({ nome, tipo: 'application/pdf', conteudo: PDF_MINIMO });

async function turmaComAluno(base, nomeTurma = 'Manhã') {
  const admin = await criarProfessor(base);
  const turma = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: nomeTurma } })).dados.turma;
  const ana = await criarAluno(base, 'Ana Ribeiro', 'ana@ex.br', turma.codigo, { matricula: '2026001' });
  return { admin, turma, ana };
}

test('o professor publica aula com material e o aluno vê e baixa o arquivo', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);

    const aula = (await admin('/api/aulas', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id,
        titulo: 'Aula 3 — Registro cursivo',
        descricao: 'Como registrar sem interpretar.',
        data_aula: '2026-04-06',
      },
    })).dados.aula;

    const material = await admin('/api/materiais', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, aula_id: aula.id, tipo: 'arquivo',
        titulo: 'Roteiro de observação', arquivo: arquivoExemplo(),
      },
    });
    assert.equal(material.status, 201, JSON.stringify(material.dados));

    await admin('/api/materiais', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, aula_id: aula.id, tipo: 'link',
        titulo: 'Vídeo da sessão', url: 'https://exemplo.br/video',
      },
    });

    const mural = await ana(`/api/turmas/${turma.id}/mural`);
    assert.equal(mural.status, 200, JSON.stringify(mural.dados));
    assert.equal(mural.dados.aulas.length, 1);
    assert.equal(mural.dados.aulas[0].titulo, 'Aula 3 — Registro cursivo');
    assert.equal(mural.dados.aulas[0].materiais.length, 2);

    const doArquivo = mural.dados.aulas[0].materiais.find((m) => m.tipo === 'arquivo');
    assert.equal(doArquivo.arquivo_nome, 'roteiro.pdf');
    const baixado = await ana(`/api/arquivos/${doArquivo.arquivo_id}`);
    assert.equal(baixado.status, 200);
    assert.match(baixado.dados.toString('utf8'), /^%PDF-1\.4/);
  });
});

test('aluno de outra turma não alcança mural nem arquivo', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma } = await turmaComAluno(base);
    const outra = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: 'Noite' } })).dados.turma;
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', outra.codigo);

    const aula = (await admin('/api/aulas', {
      metodo: 'POST', corpo: { turma_id: turma.id, titulo: 'Aula 1' },
    })).dados.aula;
    const material = (await admin('/api/materiais', {
      metodo: 'POST',
      corpo: { turma_id: turma.id, aula_id: aula.id, titulo: 'Roteiro', arquivo: arquivoExemplo() },
    })).dados.material;

    assert.equal((await bruno(`/api/turmas/${turma.id}/mural`)).status, 403);
    assert.equal((await bruno(`/api/arquivos/${material.arquivo_id}`)).status, 404);
  });
});

test('formato não aceito e arquivo grande demais são recusados', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma } = await turmaComAluno(base);

    const formato = await admin('/api/materiais', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, titulo: 'Instalador',
        arquivo: { nome: 'programa.exe', tipo: 'application/x-msdownload', conteudo: 'AAAA' },
      },
    });
    assert.equal(formato.status, 400);
    assert.match(formato.dados.erro, /Formato não aceito/);

    const grande = await admin('/api/materiais', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, titulo: 'Gigante',
        arquivo: { nome: 'g.pdf', tipo: 'application/pdf', conteudo: Buffer.alloc(7 * 1024 * 1024, 1).toString('base64') },
      },
    });
    assert.equal(grande.status, 413);
    assert.match(grande.dados.erro, /limite/i);
  });
});

test('tarefa: o aluno entrega, o professor devolve com motivo e o aluno refaz', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);
    const tarefa = (await admin('/api/tarefas', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, titulo: 'Registro da observação 3',
        enunciado: 'Descreva sem interpretar.', prazo: '2026-04-20', horas_sugeridas: 4,
        categoria_id: await idCategoria(admin, 'Registro cursivo'),
      },
    })).dados.tarefa;

    const semNada = await ana(`/api/tarefas/${tarefa.id}/entrega`, { metodo: 'PUT', corpo: { texto: '  ' } });
    assert.equal(semNada.status, 400);

    const enviada = await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT',
      corpo: { texto: 'Primeira versão do registro.', arquivo: arquivoExemplo('registro.pdf') },
    });
    assert.equal(enviada.status, 200, JSON.stringify(enviada.dados));
    assert.equal(enviada.dados.entrega.status, 'enviada');

    const fila = await admin(`/api/tarefas/${tarefa.id}/entregas`);
    assert.equal(fila.dados.entregas.length, 1);
    assert.equal(fila.dados.entregas[0].aluno_nome, 'Ana Ribeiro');
    assert.equal(fila.dados.entregas[0].arquivo_nome, 'registro.pdf');
    assert.equal(fila.dados.sem_entregar.length, 0);

    const semMotivo = await admin(`/api/entregas/${enviada.dados.entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'devolvida' },
    });
    assert.equal(semMotivo.status, 400, 'devolver exige dizer o porquê');

    const devolvida = await admin(`/api/entregas/${enviada.dados.entrega.id}/avaliacao`, {
      metodo: 'POST',
      corpo: { status: 'devolvida', observacao: 'Separe descrição de interpretação no 2º parágrafo.' },
    });
    assert.equal(devolvida.dados.entrega.status, 'devolvida');
    assert.equal(devolvida.dados.horas_lancadas, 0);
    assert.equal((await ana('/api/atividades')).dados.resumo.declarado, 0, 'devolver não lança horas');

    const mural = await ana(`/api/turmas/${turma.id}/mural`);
    const minha = mural.dados.avulsos.tarefas[0].minha_entrega;
    assert.equal(minha.status, 'devolvida');
    assert.match(minha.observacao, /descrição de interpretação/);

    const refeita = await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Versão revisada, separando descrição de interpretação.' },
    });
    assert.equal(refeita.dados.entrega.status, 'enviada');
  });
});

test('entrega aceita vira hora complementar já validada, sem duplicar ao reavaliar', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);
    const tarefa = (await admin('/api/tarefas', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, titulo: 'Registro da observação 3', horas_sugeridas: 4,
        categoria_id: await idCategoria(admin, 'Registro cursivo'),
      },
    })).dados.tarefa;
    const entrega = (await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Registro cursivo dos 40 minutos.' },
    })).dados.entrega;

    const aceita = await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'aceita', observacao: 'Bem delimitado.' },
    });
    assert.equal(aceita.dados.horas_lancadas, 4, 'usa as horas sugeridas quando nada é dito');

    const resumo = (await ana('/api/atividades')).dados;
    assert.equal(resumo.resumo.validado, 4);
    assert.equal(resumo.atividades.length, 1);
    assert.equal(resumo.atividades[0].titulo, 'Registro da observação 3');
    assert.equal(resumo.atividades[0].categoria, 'Registro cursivo');
    assert.equal(resumo.atividades[0].validado, 1);
    assert.equal(resumo.atividades[0].texto, 'Registro cursivo dos 40 minutos.');

    // Reavaliar com outra carga corrige a mesma atividade.
    const corrigida = await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'aceita', horas: 2, observacao: 'Ajustei a carga.' },
    });
    assert.equal(corrigida.dados.horas_lancadas, 2);
    const depois = (await ana('/api/atividades')).dados;
    assert.equal(depois.atividades.length, 1, 'não duplica');
    assert.equal(depois.resumo.validado, 2);

    // E o aluno não mexe mais numa entrega aceita.
    const tentativa = await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Mudando depois de aceita' },
    });
    assert.equal(tentativa.status, 409);
  });
});

test('aluno não publica aula, material nem tarefa', async () => {
  await comAmbiente(async ({ base }) => {
    const { turma, ana } = await turmaComAluno(base);
    assert.equal((await ana('/api/aulas', { metodo: 'POST', corpo: { turma_id: turma.id, titulo: 'X' } })).status, 403);
    assert.equal((await ana('/api/materiais', { metodo: 'POST', corpo: { turma_id: turma.id, titulo: 'X', tipo: 'link', url: 'https://x.br' } })).status, 403);
    assert.equal((await ana('/api/tarefas', { metodo: 'POST', corpo: { turma_id: turma.id, titulo: 'X' } })).status, 403);
  });
});

test('aula não publicada fica escondida do aluno', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);
    await admin('/api/aulas', {
      metodo: 'POST', corpo: { turma_id: turma.id, titulo: 'Rascunho da aula 4', publicada: false },
    });
    await admin('/api/aulas', { metodo: 'POST', corpo: { turma_id: turma.id, titulo: 'Aula 3' } });

    assert.equal((await ana(`/api/turmas/${turma.id}/mural`)).dados.aulas.length, 1);
    assert.equal((await admin(`/api/turmas/${turma.id}/mural`)).dados.aulas.length, 2);
  });
});

// ---------------------------------------------------------------- status e auditoria

test('a atividade nasce pendente e o coordenador aprova com menos horas', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, ana } = await turmaComAluno(base);
    const criada = await ana('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, horas: 10 } });
    assert.equal(criada.dados.atividade.status, 'pendente');
    assert.equal(criada.dados.resumo.aguardando, 10);
    assert.equal(criada.dados.resumo.validado, 0);

    const demais = await admin(`/api/atividades/${criada.dados.atividade.id}/analise`, {
      metodo: 'POST', corpo: { status: 'aprovado', horas_aprovadas: 12 },
    });
    assert.equal(demais.status, 400, 'não dá para aprovar mais do que foi declarado');

    const aprovada = await admin(`/api/atividades/${criada.dados.atividade.id}/analise`, {
      metodo: 'POST',
      corpo: { status: 'aprovado', horas_aprovadas: 6, motivo: 'Duas horas eram deslocamento.' },
    });
    assert.equal(aprovada.dados.atividade.status, 'aprovado');
    assert.equal(aprovada.dados.atividade.horas_aprovadas, 6);

    const resumo = (await ana('/api/atividades')).dados.resumo;
    assert.equal(resumo.validado, 6, 'conta o que foi aprovado, não o declarado');
    assert.equal(resumo.declarado, 10);
    assert.equal(resumo.aguardando, 0);
  });
});

test('reprovar e devolver para correção exigem motivo', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, ana } = await turmaComAluno(base);
    const id = (await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase })).dados.atividade.id;

    const semMotivo = await admin(`/api/atividades/${id}/analise`, { metodo: 'POST', corpo: { status: 'reprovado' } });
    assert.equal(semMotivo.status, 400);
    assert.match(semMotivo.dados.erro, /por que/i);

    const semTexto = await admin(`/api/atividades/${id}/analise`, { metodo: 'POST', corpo: { status: 'correcao' } });
    assert.equal(semTexto.status, 400);
    assert.match(semTexto.dados.erro, /corrigido/i);

    const reprovada = await admin(`/api/atividades/${id}/analise`, {
      metodo: 'POST', corpo: { status: 'reprovado', motivo: 'O certificado não cobre essa carga.' },
    });
    assert.equal(reprovada.dados.atividade.status, 'reprovado');
    assert.equal(reprovada.dados.atividade.motivo, 'O certificado não cobre essa carga.');

    const resumo = (await ana('/api/atividades')).dados.resumo;
    assert.equal(resumo.reprovado, 2.5);
    assert.equal(resumo.validado, 0);
    assert.equal(resumo.aguardando, 0);
  });
});

test('a trilha guarda cada passo, e nada é apagado', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, ana } = await turmaComAluno(base);
    const id = (await ana('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, horas: 8 } })).dados.atividade.id;

    await admin(`/api/atividades/${id}/analise`, { metodo: 'POST', corpo: { status: 'em_analise' } });
    await admin(`/api/atividades/${id}/analise`, {
      metodo: 'POST', corpo: { status: 'correcao', motivo: 'Falta a assinatura no certificado.' },
    });
    // Devolvida, ela não é mais editada: o aluno reenvia.
    const edicao = await ana(`/api/atividades/${id}`, { metodo: 'PUT', corpo: { ...atividadeBase, horas: 8 } });
    assert.equal(edicao.status, 409);
    assert.match(edicao.dados.erro, /Reenviar para validação/);
    await ana(`/api/atividades/${id}/reenviar`, {
      metodo: 'POST', corpo: { horas_revisao: 1, texto: 'Corrigido.' },
    });
    await admin(`/api/atividades/${id}/analise`, {
      metodo: 'POST', corpo: { status: 'aprovado', horas_aprovadas: 5, motivo: 'Aprovado com carga ajustada.' },
    });

    const { historico } = (await admin(`/api/atividades/${id}/historico`)).dados;
    assert.equal(historico.length, 5, 'criada, em análise, correção, reenvio e aprovação');
    assert.deepEqual(historico.map((h) => h.acao), ['criada', 'em_analise', 'correcao', 'reenviada', 'aprovado']);
    assert.match(historico[2].descricao, /Falta a assinatura/);
    assert.match(historico[3].descricao, /1 h de correção somadas/);
    assert.match(historico[4].descricao, /5 h/);
    assert.match(historico[4].descricao, /havia declarado 9/, 'as 8 h mais 1 h de correção');
    assert.equal(historico[0].usuario_nome, 'Ana Ribeiro');
    assert.equal(historico[4].papel, 'admin');
    assert.ok(historico.every((h) => h.criado_em));

    // O aluno vê a própria trilha; um colega não vê.
    assert.equal((await ana(`/api/atividades/${id}/historico`)).status, 200);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br',
      (await admin('/api/turmas')).dados.turmas[0].codigo);
    assert.equal((await bruno(`/api/atividades/${id}/historico`)).status, 404);
  });
});

test('editar depois de aprovada devolve a atividade para a fila', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, ana } = await turmaComAluno(base);
    const id = (await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase })).dados.atividade.id;
    await admin(`/api/atividades/${id}/analise`, { metodo: 'POST', corpo: { status: 'aprovado' } });
    assert.equal((await ana('/api/atividades')).dados.resumo.validado, 2.5);

    const editada = await ana(`/api/atividades/${id}`, {
      metodo: 'PUT', corpo: { ...atividadeBase, horas: 5 },
    });
    assert.equal(editada.dados.atividade.status, 'pendente');
    assert.equal(editada.dados.atividade.horas_aprovadas, null);
    assert.equal(editada.dados.resumo.validado, 0);
    assert.equal(editada.dados.resumo.aguardando, 5);
  });
});

test('a planilha traz horas declaradas, aprovadas e o status', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, ana } = await turmaComAluno(base);
    const id = (await ana('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, horas: 9 } })).dados.atividade.id;
    await admin(`/api/atividades/${id}/analise`, { metodo: 'POST', corpo: { status: 'aprovado', horas_aprovadas: 7 } });

    const csv = await ana('/api/exportar.csv');
    assert.match(csv.dados, /horas_declaradas;horas_aprovadas;status/);
    assert.match(csv.dados, /"9";"7";"aprovado"/);
  });
});

test('slide e documento são aceitos, e o tipo sai da extensão quando falta', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);
    const conteudo = Buffer.from('PK\u0003\u0004 conteudo do slide').toString('base64');

    const slide = await admin('/api/materiais', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, titulo: 'Aula 3 em slides',
        arquivo: {
          nome: 'aula-3.pptx',
          tipo: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          conteudo,
        },
      },
    });
    assert.equal(slide.status, 201, JSON.stringify(slide.dados));

    // Celular costuma mandar tipo vazio: a extensão resolve.
    const semTipo = await admin('/api/materiais', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, titulo: 'Texto de apoio',
        arquivo: { nome: 'apoio.docx', tipo: '', conteudo },
      },
    });
    assert.equal(semTipo.status, 201, JSON.stringify(semTipo.dados));

    const mural = await ana(`/api/turmas/${turma.id}/mural`);
    const nomes = mural.dados.avulsos.materiais.map((m) => m.arquivo_nome).sort();
    assert.deepEqual(nomes, ['apoio.docx', 'aula-3.pptx']);
  });
});

test('a aula pode ser publicada já com o arquivo anexado', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);
    const criada = await admin('/api/aulas', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id,
        titulo: 'Aula 4 — Categorias de observação',
        data_aula: '2026-04-13',
        arquivo: { nome: 'aula-4.pptx', tipo: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', conteudo: Buffer.from('slide').toString('base64') },
      },
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.dados));

    const mural = await ana(`/api/turmas/${turma.id}/mural`);
    const aula = mural.dados.aulas.find((a) => a.titulo.startsWith('Aula 4'));
    assert.equal(aula.materiais.length, 1, 'o arquivo virou material da aula');
    assert.equal(aula.materiais[0].arquivo_nome, 'aula-4.pptx');

    const baixado = await ana(`/api/arquivos/${aula.materiais[0].arquivo_id}`);
    assert.equal(baixado.status, 200);
  });
});

test('a tela recebe o limite de tamanho do destino de arquivos', async () => {
  await comAmbiente(async ({ base }) => {
    const { ana } = await turmaComAluno(base);
    const eu = await ana('/api/eu');
    assert.equal(eu.dados.limite_arquivo, 6 * 1024 * 1024, 'destino D1 nos testes');
    assert.ok(eu.dados.formatos.includes('pptx'));
  });
});

test('o aluno entrega a tarefa com arquivo de slide', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);
    const tarefa = (await admin('/api/tarefas', {
      metodo: 'POST', corpo: { turma_id: turma.id, titulo: 'Apresentação do caso', horas_sugeridas: 3 },
    })).dados.tarefa;

    const entrega = await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT',
      corpo: {
        texto: 'Segue a apresentação usada no seminário.',
        arquivo: {
          nome: 'caso-clinico.pptx',
          tipo: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          conteudo: Buffer.from('slide da entrega').toString('base64'),
        },
      },
    });
    assert.equal(entrega.status, 200, JSON.stringify(entrega.dados));

    const fila = await admin(`/api/tarefas/${tarefa.id}/entregas`);
    assert.equal(fila.dados.entregas[0].arquivo_nome, 'caso-clinico.pptx');
    const baixado = await admin(`/api/arquivos/${fila.dados.entregas[0].arquivo_id}`);
    assert.equal(baixado.status, 200);
  });
});

test('arquivo de vários MB vai e volta inteiro, fatiado no banco', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, turma, ana } = await turmaComAluno(base);

    // 2,5 MB com conteúdo variado: se a remontagem trocar a ordem das partes,
    // o que volta não bate.
    const original = Buffer.alloc(2.5 * 1024 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 31 + (i >> 8)) % 251;

    const material = await admin('/api/materiais', {
      metodo: 'POST',
      corpo: {
        turma_id: turma.id, titulo: 'Slides completos',
        arquivo: {
          nome: 'aula-completa.pptx',
          tipo: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          conteudo: original.toString('base64'),
        },
      },
    });
    assert.equal(material.status, 201, JSON.stringify(material.dados));

    const baixado = await ana(`/api/arquivos/${material.dados.material.arquivo_id}`);
    assert.equal(baixado.status, 200);
    assert.equal(baixado.dados.length, original.length, 'volta com o tamanho original');
    assert.ok(baixado.dados.equals(original), 'volta byte a byte, na ordem certa');
    assert.match(baixado.tipo, /presentationml/);

    // E continua fechado para quem não está na turma.
    assert.equal((await cliente(base)(`/api/arquivos/${material.dados.material.arquivo_id}`)).status, 401);
  });
});

// ---------------------------------------------------------------- aula em várias turmas

test('uma aula publicada para duas turmas aparece nas duas, com o material', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const manha = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3A — manhã' } })).dados.turma;
    const noite = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3B — noite' } })).dados.turma;
    const outra = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '2A — outra' } })).dados.turma;

    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', manha.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', noite.codigo);
    const carla = await criarAluno(base, 'Carla', 'carla@ex.br', outra.codigo);

    const aula = await admin('/api/aulas', {
      metodo: 'POST',
      corpo: {
        turma_ids: [manha.id, noite.id],
        titulo: 'Aula 3 — Registro cursivo',
        data_aula: '2026-04-06',
        arquivo: arquivoExemplo('slides-aula-3.pdf'),
      },
    });
    assert.equal(aula.status, 201, JSON.stringify(aula.dados));
    assert.deepEqual(aula.dados.materias.map((m) => m.turma_nome).sort(), ['3A — manhã', '3B — noite']);

    for (const [quem, turma] of [[ana, manha], [bruno, noite]]) {
      const mural = await quem(`/api/turmas/${turma.id}/mural`);
      assert.equal(mural.dados.aulas.length, 1, `${turma.nome} deveria ver a aula`);
      assert.equal(mural.dados.aulas[0].materiais.length, 1);
      const arquivoId = mural.dados.aulas[0].materiais[0].arquivo_id;
      assert.equal((await quem(`/api/arquivos/${arquivoId}`)).status, 200, 'baixa o material');
    }

    assert.equal((await carla(`/api/turmas/${outra.id}/mural`)).dados.aulas.length, 0, 'turma de fora não vê');
  });
});

test('a tarefa da aula compartilhada recebe entregas das duas turmas', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const manha = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3A' } })).dados.turma;
    const noite = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3B' } })).dados.turma;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', manha.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', noite.codigo);
    await criarAluno(base, 'Caio', 'caio@ex.br', noite.codigo);

    const aula = (await admin('/api/aulas', {
      metodo: 'POST', corpo: { turma_ids: [manha.id, noite.id], titulo: 'Aula 3' },
    })).dados.aula;

    // Sem dizer as matérias: a tarefa herda as da aula.
    const tarefa = await admin('/api/tarefas', {
      metodo: 'POST',
      corpo: { aula_id: aula.id, titulo: 'Registro da observação', horas_sugeridas: 3 },
    });
    assert.equal(tarefa.status, 201, JSON.stringify(tarefa.dados));
    assert.equal(tarefa.dados.materias.length, 2, 'herdou as duas matérias da aula');

    const id = tarefa.dados.tarefa.id;
    assert.equal((await ana(`/api/tarefas/${id}/entrega`, { metodo: 'PUT', corpo: { texto: 'Entrega da Ana' } })).status, 200);
    assert.equal((await bruno(`/api/tarefas/${id}/entrega`, { metodo: 'PUT', corpo: { texto: 'Entrega do Bruno' } })).status, 200);

    const fila = await admin(`/api/tarefas/${id}/entregas`);
    assert.deepEqual(fila.dados.entregas.map((e) => e.aluno_nome).sort(), ['Ana', 'Bruno']);
    assert.deepEqual(fila.dados.entregas.map((e) => e.turma_nome).sort(), ['3A', '3B']);
    assert.deepEqual(fila.dados.sem_entregar.map((a) => a.nome), ['Caio'], 'quem falta, nas duas turmas');

    // Cada aluno vê só a própria entrega no mural da turma dele.
    const muralAna = await ana(`/api/turmas/${manha.id}/mural`);
    assert.equal(muralAna.dados.aulas[0].tarefas[0].minha_entrega.texto, 'Entrega da Ana');
  });
});

test('professor que alcança uma das turmas avalia a tarefa compartilhada', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const helena = await criarProfessorConvidado(base, admin, 'Profa. Helena', 'helena@exemplo.br');
    const daHelena = (await helena('/api/turmas', { metodo: 'POST', corpo: { nome: 'Turma da Helena' } })).dados.turma;
    const doAdmin = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: 'Turma do admin' } })).dados.turma;

    // O admin alcança as duas turmas, então publica para ambas.
    const aula = (await admin('/api/aulas', {
      metodo: 'POST', corpo: { turma_ids: [daHelena.id, doAdmin.id], titulo: 'Aula conjunta' },
    })).dados.aula;
    const tarefa = (await admin('/api/tarefas', {
      metodo: 'POST', corpo: { aula_id: aula.id, titulo: 'Trabalho conjunto', horas_sugeridas: 2 },
    })).dados.tarefa;

    const aluna = await criarAluno(base, 'Ana', 'ana@ex.br', daHelena.codigo);
    const entrega = (await aluna(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Feito.' },
    })).dados.entrega;

    // Helena alcança só a turma dela, e isso basta para avaliar a entrega dessa aluna.
    const avaliada = await helena(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'aceita', horas: 2 },
    });
    assert.equal(avaliada.status, 200, JSON.stringify(avaliada.dados));
    assert.equal((await aluna('/api/atividades')).dados.resumo.validado, 2);

    // Um terceiro professor, sem nenhuma das turmas, não alcança nada.
    const rafael = await criarProfessorConvidado(base, admin, 'Prof. Rafael', 'rafael@exemplo.br');
    assert.equal((await rafael(`/api/tarefas/${tarefa.id}/entregas`)).status, 404);
    assert.equal((await rafael(`/api/aulas/${aula.id}`, { metodo: 'DELETE' })).status, 404);
  });
});

test('editar a aula troca as turmas que a recebem', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const manha = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3A' } })).dados.turma;
    const noite = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3B' } })).dados.turma;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', manha.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', noite.codigo);

    const aula = (await admin('/api/aulas', {
      metodo: 'POST', corpo: { turma_ids: [manha.id], titulo: 'Aula 3' },
    })).dados.aula;
    assert.equal((await bruno(`/api/turmas/${noite.id}/mural`)).dados.aulas.length, 0);

    const editada = await admin(`/api/aulas/${aula.id}`, {
      metodo: 'PUT', corpo: { titulo: 'Aula 3', turma_ids: [manha.id, noite.id] },
    });
    assert.equal(editada.dados.materias.length, 2);
    assert.equal((await bruno(`/api/turmas/${noite.id}/mural`)).dados.aulas.length, 1, 'agora alcança 3B');
    assert.equal((await ana(`/api/turmas/${manha.id}/mural`)).dados.aulas.length, 1, 'e continua em 3A');
  });
});

// ---------------------------------------------------------------- turma sem horas e anotações

// ---------------------------------------------------------------- matérias

test('o aluno anexa o comprovante em PDF na atividade, e só quem valida abre', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const turma = await criarTurma(admin, 'Manhã');
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', turma.codigo);
    const outra = await criarProfessorConvidado(base, admin, 'Profa. Sonia', 'sonia@ex.br');
    const deFora = await criarAluno(
      base, 'Bruno', 'bruno@ex.br', (await criarTurma(outra, 'Outra')).codigo,
    );

    const criada = await ana('/api/atividades', {
      metodo: 'POST',
      corpo: { ...atividadeBase, arquivo: arquivoExemplo('certificado.pdf') },
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.dados));
    const atividade = criada.dados.atividade;
    assert.ok(atividade.arquivo_id, 'a atividade guarda o arquivo, não só o nome');
    assert.equal(atividade.arquivo_nome, 'certificado.pdf');

    // O aluno baixa o próprio comprovante; o professor da turma também.
    assert.equal((await ana(`/api/arquivos/${atividade.arquivo_id}`)).status, 200);
    assert.equal((await admin(`/api/arquivos/${atividade.arquivo_id}`)).status, 200);

    // Sem ?baixar o arquivo abre na tela; com ele, o navegador salva.
    const paraVer = await admin(`/api/arquivos/${atividade.arquivo_id}`);
    assert.equal(paraVer.tipo, 'application/pdf');
    assert.match(paraVer.cabecalhos['content-disposition'], /^inline/);
    const paraBaixar = await admin(`/api/arquivos/${atividade.arquivo_id}?baixar`);
    assert.match(paraBaixar.cabecalhos['content-disposition'], /^attachment; filename="certificado.pdf"/);
    // Quem não acompanha esse aluno, não.
    assert.equal((await outra(`/api/arquivos/${atividade.arquivo_id}`)).status, 404);
    assert.equal((await deFora(`/api/arquivos/${atividade.arquivo_id}`)).status, 404);

    // Editar sem mandar arquivo novo mantém o que já estava anexado.
    const editada = await ana(`/api/atividades/${atividade.id}`, {
      metodo: 'PUT', corpo: { ...atividadeBase, horas: 3 },
    });
    assert.equal(editada.dados.atividade.arquivo_id, atividade.arquivo_id);

    // A análise também pode vir em arquivo, separada do comprovante.
    const comRelatorio = await ana(`/api/atividades/${atividade.id}`, {
      metodo: 'PUT',
      corpo: { ...atividadeBase, arquivo_analise: arquivoExemplo('relatorio.pdf') },
    });
    const dois = comRelatorio.dados.atividade;
    assert.equal(dois.analise_arquivo_nome, 'relatorio.pdf');
    assert.notEqual(dois.analise_arquivo_id, dois.arquivo_id, 'são dois arquivos diferentes');
    assert.equal((await ana(`/api/arquivos/${dois.analise_arquivo_id}`)).status, 200);
    assert.equal((await admin(`/api/arquivos/${dois.analise_arquivo_id}`)).status, 200);
    assert.equal((await outra(`/api/arquivos/${dois.analise_arquivo_id}`)).status, 404);
  });
});

test('tarefa de matéria sem horas é corrigida com nota, não com hora complementar', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const sala = (await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: '3A', materia: 'Psicologia do Desenvolvimento' },
    })).dados;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', sala.turma.codigo);

    const tarefa = (await admin('/api/tarefas', {
      metodo: 'POST',
      corpo: {
        materia_ids: [sala.materias[0].id],
        titulo: 'Fichamento do capítulo 2',
        nota_maxima: 10,
      },
    })).dados.tarefa;
    assert.equal(tarefa.nota_maxima, 10);

    const entrega = (await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Meu fichamento.' },
    })).dados.entrega;

    const alta = await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'aceita', nota: 12 },
    });
    assert.equal(alta.status, 400);
    assert.match(alta.dados.erro, /nota máxima/);

    const aceita = await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'aceita', nota: 8.5, observacao: 'Boa síntese.' },
    });
    assert.equal(aceita.status, 200, JSON.stringify(aceita.dados));
    assert.equal(aceita.dados.entrega.nota, 8.5);

    // Nota não vira hora complementar: o histórico do aluno continua vazio.
    assert.equal((await ana('/api/atividades')).dados.atividades.length, 0);
    assert.equal((await ana('/api/eu')).dados.resumo.validado, 0);

    const mural = await ana(`/api/turmas/${sala.turma.id}/mural`);
    const minha = mural.dados.materias[0].avulsos.tarefas[0].minha_entrega;
    assert.equal(minha.nota, 8.5);
    assert.equal(minha.observacao, 'Boa síntese.');
  });
});

test('dois professores dividem a mesma sala, cada um com a sua matéria', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const sala = (await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: '3º Psicologia — manhã', materia: 'Técnicas de Observação' },
    })).dados;

    // O segundo professor entra na sala com o mesmo código que o aluno usa.
    const helena = await criarProfessorConvidado(base, admin, 'Profa. Helena', 'helena@ex.br');
    const dela = await helena('/api/materias', {
      metodo: 'POST',
      corpo: { codigo_turma: sala.turma.codigo, nome: 'Estágio supervisionado', conta_horas: true },
    });
    assert.equal(dela.status, 201, JSON.stringify(dela.dados));

    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', sala.turma.codigo);
    const eu = await ana('/api/eu');
    assert.deepEqual(
      eu.dados.materias.map((m) => `${m.nome} — ${m.professor_nome}`).sort(),
      ['Estágio supervisionado — Profa. Helena', 'Técnicas de Observação — Profa. Marina'],
      'o aluno passa a ter os dois professores',
    );
    assert.equal(eu.dados.conta_horas, true, 'basta uma matéria de estágio na sala');

    // Cada professor publica na matéria dele.
    await admin('/api/aulas', {
      metodo: 'POST', corpo: { materia_ids: [sala.materias[0].id], titulo: 'Registro cursivo' },
    });
    await helena('/api/aulas', {
      metodo: 'POST', corpo: { materia_ids: [dela.dados.materia.id], titulo: 'Primeira visita ao campo' },
    });

    const naSala = await ana(`/api/turmas/${sala.turma.id}/mural`);
    assert.deepEqual(
      naSala.dados.materias.map((m) => m.aulas.map((a) => a.titulo)).flat().sort(),
      ['Primeira visita ao campo', 'Registro cursivo'],
      'o aluno vê o mural das duas matérias',
    );

    // Helena alcança a sala, mas o mural dela mostra só a matéria dela.
    const daHelena = await helena(`/api/turmas/${sala.turma.id}/mural`);
    assert.deepEqual(daHelena.dados.materias.map((m) => m.nome), ['Estágio supervisionado']);
    assert.equal(
      (await helena(`/api/materias/${sala.materias[0].id}/mural`)).status, 404,
      'a matéria do colega não é dela',
    );

    // E ela enxerga os alunos da sala, porque também dá aula para eles.
    const alunos = await helena('/api/turma');
    assert.deepEqual(alunos.dados.alunos.map((a) => a.nome), ['Ana']);

    // Mas a sala não é dela: mexer na turma em si continua sendo de quem criou.
    const tentativa = await helena(`/api/turmas/${sala.turma.id}`, {
      metodo: 'PUT', corpo: { nome: 'Turma da Helena' },
    });
    assert.equal(tentativa.status, 403);
    assert.equal((await helena(`/api/turmas/${sala.turma.id}`, { metodo: 'DELETE' })).status, 403);
  });
});

test('o professor tem matérias em salas diferentes e publica para as duas de uma vez', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const manha = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3A', materia: 'Observação' } })).dados;
    const noite = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3B', materia: 'Observação' } })).dados;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', manha.turma.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', noite.turma.codigo);

    const minhas = await admin('/api/materias');
    assert.deepEqual(minhas.dados.materias.map((m) => m.turma_nome).sort(), ['3A', '3B']);

    const aula = await admin('/api/aulas', {
      metodo: 'POST',
      corpo: { materia_ids: minhas.dados.materias.map((m) => m.id), titulo: 'Aula 3' },
    });
    assert.equal(aula.status, 201, JSON.stringify(aula.dados));
    assert.equal((await ana(`/api/turmas/${manha.turma.id}/mural`)).dados.aulas.length, 1);
    assert.equal((await bruno(`/api/turmas/${noite.turma.id}/mural`)).dados.aulas.length, 1);
  });
});

test('matéria com aula não some por engano', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const sala = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: '3A', materia: 'Observação' } })).dados;
    const materiaId = sala.materias[0].id;
    await admin('/api/aulas', { metodo: 'POST', corpo: { materia_ids: [materiaId], titulo: 'Aula 1' } });

    const recusa = await admin(`/api/materias/${materiaId}`, { metodo: 'DELETE' });
    assert.equal(recusa.status, 409);
    assert.match(recusa.dados.erro, /Apague-as antes/);

    const nova = await admin('/api/materias', {
      metodo: 'POST', corpo: { turma_id: sala.turma.id, nome: 'Seminário' },
    });
    assert.equal((await admin(`/api/materias/${nova.dados.materia.id}`, { metodo: 'DELETE' })).status, 200);
  });
});

test('matéria comum não gera horas; matéria de estágio gera', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const disciplina = (await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: '3A — Psicologia', materia: 'Psicologia do Desenvolvimento' },
    })).dados;
    const estagio = (await admin('/api/turmas', {
      metodo: 'POST',
      corpo: { nome: 'Estágio 2026', materia: 'Estágio supervisionado', conta_horas: true, meta_horas: 300 },
    })).dados;

    assert.equal(disciplina.materias[0].conta_horas, 0);
    assert.equal(estagio.materias[0].conta_horas, 1);

    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', disciplina.turma.codigo);
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', estagio.turma.codigo);
    assert.equal((await ana('/api/eu')).dados.conta_horas, false, 'sala só de disciplina não mostra horas');
    assert.equal((await bruno('/api/eu')).dados.conta_horas, true);

    // A matéria pode passar a contar depois, sem recriar nada.
    const virou = await admin(`/api/materias/${disciplina.materias[0].id}`, {
      metodo: 'PUT', corpo: { conta_horas: true },
    });
    assert.equal(virou.dados.materia.conta_horas, 1);
    assert.equal((await ana('/api/eu')).dados.conta_horas, true);
  });
});

test('o professor anota sobre o aluno, e o aluno não enxerga nada disso', async () => {
  await comAmbiente(async ({ base }) => {
    const { admin, ana } = await turmaComAluno(base);
    const alunoId = (await admin('/api/turma')).dados.alunos[0].id;

    const criada = await admin(`/api/alunos/${alunoId}/anotacoes`, {
      metodo: 'POST',
      corpo: { texto: 'Faltou nos dois últimos encontros de campo. Combinamos reposição em 12/05.' },
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.dados));

    const lista = await admin(`/api/alunos/${alunoId}/anotacoes`);
    assert.equal(lista.dados.anotacoes.length, 1);
    assert.equal(lista.dados.anotacoes[0].autor_nome, 'Profa. Marina');
    assert.match(lista.dados.anotacoes[0].texto, /reposição/);

    // O aluno não alcança a rota, nem a dele mesmo.
    assert.equal((await ana(`/api/alunos/${alunoId}/anotacoes`)).status, 403);
    assert.equal((await ana(`/api/alunos/${alunoId}/anotacoes`, { metodo: 'POST', corpo: { texto: 'x' } })).status, 403);

    // Nada de anotação vaza no que o aluno lê.
    const dele = JSON.stringify([(await ana('/api/eu')).dados, (await ana('/api/atividades')).dados]);
    assert.doesNotMatch(dele, /reposição/);
  });
});

test('anotação só é editada por quem escreveu, e só sobre aluno ao alcance', async () => {
  await comAmbiente(async ({ base }) => {
    const admin = await criarProfessor(base);
    const helena = await criarProfessorConvidado(base, admin, 'Profa. Helena', 'helena@exemplo.br');
    const turmaAdmin = (await admin('/api/turmas', { metodo: 'POST', corpo: { nome: 'Turma do admin' } })).dados.turma;
    await criarAluno(base, 'Ana', 'ana@ex.br', turmaAdmin.codigo);
    const alunoId = (await admin('/api/turma')).dados.alunos[0].id;

    const anotacao = (await admin(`/api/alunos/${alunoId}/anotacoes`, {
      metodo: 'POST', corpo: { texto: 'Observação do admin.' },
    })).dados.anotacao;

    // Helena não alcança a turma do admin.
    assert.equal((await helena(`/api/alunos/${alunoId}/anotacoes`)).status, 404);
    assert.equal((await helena(`/api/anotacoes/${anotacao.id}`, { metodo: 'PUT', corpo: { texto: 'mudou' } })).status, 404);
    assert.equal((await helena(`/api/anotacoes/${anotacao.id}`, { metodo: 'DELETE' })).status, 404);

    const editada = await admin(`/api/anotacoes/${anotacao.id}`, {
      metodo: 'PUT', corpo: { texto: 'Observação revisada.' },
    });
    assert.equal(editada.dados.anotacao.texto, 'Observação revisada.');
    assert.equal((await admin(`/api/anotacoes/${anotacao.id}`, { metodo: 'DELETE' })).status, 200);
    assert.equal((await admin(`/api/alunos/${alunoId}/anotacoes`)).dados.anotacoes.length, 0);
  });
});

// Migração que ficou para trás é o erro mais comum depois de publicar: a tela
// precisa dizer o que fazer, não um "erro interno" que não ajuda ninguém.
test('banco atrás do código responde dizendo que faltam migrações', async () => {
  const bd = bancoLocal(':memory:');
  const atrasado = {
    ...bd,
    async run(sql, ...parametros) {
      if (/INSERT INTO atividades/i.test(sql)) {
        throw new Error('SQLITE_ERROR: table atividades has no column named arquivo_id');
      }
      return bd.run(sql, ...parametros);
    },
  };
  const servidor = criarServidor(atrasado, { arquivos: armazenamentoD1(bd) });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const professor = await criarProfessor(base);
    const turma = await criarTurma(professor, 'Manhã');
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', turma.codigo);

    const r = await ana('/api/atividades', { metodo: 'POST', corpo: atividadeBase });
    assert.equal(r.status, 500);
    assert.match(r.dados.erro, /faltam migrações/);
    assert.match(r.dados.erro, /npm run banco:migrar/);
  } finally {
    await new Promise((r) => servidor.close(r));
  }
});

// ---------------------------------------------------------------- avisos e revisão

// Um serviço de e-mail de mentira: guarda o que teria sido enviado.
function emailDeTeste() {
  const enviados = [];
  return {
    enviados,
    ativo: true,
    async enviar({ para, assunto, texto, anexos = [] }) {
      enviados.push({ para, assunto, texto, anexos });
      return { enviado: true };
    },
  };
}

async function comEmail(fn) {
  const bd = bancoLocal(':memory:');
  const email = emailDeTeste();
  const servidor = criarServidor(bd, { arquivos: armazenamentoD1(bd), email });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    await fn({ base: `http://127.0.0.1:${servidor.address().port}`, email });
  } finally {
    await new Promise((r) => servidor.close(r));
  }
}

test('o professor recebe e-mail a cada envio do aluno', async () => {
  await comEmail(async ({ base, email }) => {
    const admin = await criarProfessor(base);
    const sala = (await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: '3A', materia: 'Estágio', conta_horas: true },
    })).dados;
    const ana = await criarAluno(base, 'Ana Ribeiro', 'ana@ex.br', sala.turma.codigo);

    // 1. hora complementar lançada pelo aluno: a atividade inteira vai no
    //    e-mail, com o arquivo que ela levava junto.
    await ana('/api/atividades', {
      metodo: 'POST',
      corpo: { ...atividadeBase, arquivo: arquivoExemplo('certificado.pdf') },
    });
    assert.equal(email.enviados.length, 1);
    assert.deepEqual(email.enviados[0].para, ['marina@exemplo.br']);
    assert.match(email.enviados[0].assunto, /Horas para validar.*Ana Ribeiro/);
    const corpo = email.enviados[0].texto;
    assert.match(corpo, /Atividade: Observação livre no pátio/);
    assert.match(corpo, /Carga declarada: 2.5 h/);
    assert.match(corpo, /Local: EMEI Vila Nova/);
    assert.match(corpo, /Certificado: Certificado 2026\/031/);
    assert.match(corpo, /Registro cursivo do terceiro encontro/, 'a análise vai no corpo');
    assert.deepEqual(email.enviados[0].anexos.map((a) => a.nome), ['certificado.pdf']);

    // 2. entrega de tarefa
    const tarefa = (await admin('/api/tarefas', {
      metodo: 'POST',
      corpo: { materia_ids: [sala.materias[0].id], titulo: 'Relatório', horas_sugeridas: 4 },
    })).dados.tarefa;
    await ana(`/api/tarefas/${tarefa.id}/entrega`, { metodo: 'PUT', corpo: { texto: 'Segue.' } });
    assert.equal(email.enviados.length, 2);
    assert.match(email.enviados[1].assunto, /Nova entrega: Relatório — Ana Ribeiro/);

    // A tela sabe dizer se o envio está ligado neste servidor.
    assert.equal((await admin('/api/eu')).dados.email_configurado, true);

    // Quem desligou o aviso em "Meus dados" para de receber.
    await admin('/api/eu', { metodo: 'PUT', corpo: { nome: 'Profa. Marina', avisar_email: false } });
    await ana('/api/atividades', { metodo: 'POST', corpo: { ...atividadeBase, titulo: 'Outra' } });
    assert.equal(email.enviados.length, 2, 'nada de novo depois de desligar');
  });
});

test('o tempo que o aluno leva refazendo entra nas horas da tarefa', async () => {
  await comEmail(async ({ base, email }) => {
    const admin = await criarProfessor(base);
    const sala = (await admin('/api/turmas', {
      metodo: 'POST', corpo: { nome: '3A', materia: 'Estágio', conta_horas: true },
    })).dados;
    const ana = await criarAluno(base, 'Ana', 'ana@ex.br', sala.turma.codigo);

    const tarefa = (await admin('/api/tarefas', {
      metodo: 'POST',
      corpo: { materia_ids: [sala.materias[0].id], titulo: 'Registro de campo', horas_sugeridas: 4 },
    })).dados.tarefa;

    const entrega = (await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Primeira versão.' },
    })).dados.entrega;

    // O professor pede revisão.
    await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'devolvida', observacao: 'Falta a cena em ordem.' },
    });

    // O aluno refaz e informa quanto tempo levou nisso.
    const refeita = await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Segunda versão, em ordem.', horas_revisao: 1.5 },
    });
    assert.equal(refeita.dados.entrega.horas_revisao, 1.5);
    assert.match(email.enviados.at(-1).assunto, /Entrega refeita/);
    assert.match(email.enviados.at(-1).texto, /revisão informado pelo aluno: 1.5 h/);

    // Aceitar sem digitar nada lança as 4 h da tarefa mais 1,5 h de revisão.
    const aceita = await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'aceita' },
    });
    assert.equal(aceita.dados.horas_lancadas, 5.5);
    assert.equal((await ana('/api/eu')).dados.resumo.validado, 5.5);

    // Refazer de novo soma ao que já havia sido informado.
    await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'devolvida', observacao: 'Mais uma coisa.' },
    });
    const terceira = await ana(`/api/tarefas/${tarefa.id}/entrega`, {
      metodo: 'PUT', corpo: { texto: 'Terceira versão.', horas_revisao: 0.5 },
    });
    assert.equal(terceira.dados.entrega.horas_revisao, 2);

    // E o professor pode digitar outro número por cima do sugerido.
    const final = await admin(`/api/entregas/${entrega.id}/avaliacao`, {
      metodo: 'POST', corpo: { status: 'aceita', horas: 5 },
    });
    assert.equal(final.dados.horas_lancadas, 5);
    assert.equal((await ana('/api/eu')).dados.resumo.validado, 5, 'a atividade é a mesma, não duplica');
  });
});

test('depois de devolvida, o aluno reenvia com o tempo da correção — e não edita', async () => {
  await comEmail(async ({ base, email }) => {
    const admin = await criarProfessor(base);
    const turma = await criarTurma(admin, 'Manhã');
    const ana = await criarAluno(base, 'Ana Ribeiro', 'ana@ex.br', turma.codigo);

    const id = (await ana('/api/atividades', {
      metodo: 'POST', corpo: { ...atividadeBase, horas: 6 },
    })).dados.atividade.id;

    // Enquanto está na fila normal, editar continua valendo.
    assert.equal(
      (await ana(`/api/atividades/${id}`, { metodo: 'PUT', corpo: { ...atividadeBase, horas: 6 } })).status,
      200,
    );

    await admin(`/api/atividades/${id}/analise`, {
      metodo: 'POST', corpo: { status: 'correcao', motivo: 'Falta anexar o certificado.' },
    });

    // Agora a porta é o reenvio, e ele cobra o tempo da correção.
    const semHoras = await ana(`/api/atividades/${id}/reenviar`, { metodo: 'POST', corpo: { texto: 'Pronto.' } });
    assert.equal(semHoras.status, 400);
    assert.match(semHoras.dados.erro, /quantas horas/);

    const reenviada = await ana(`/api/atividades/${id}/reenviar`, {
      metodo: 'POST',
      corpo: { horas_revisao: 2, texto: 'Refeito com o certificado.', arquivo: arquivoExemplo('certificado.pdf') },
    });
    assert.equal(reenviada.status, 200, JSON.stringify(reenviada.dados));
    const depois = reenviada.dados.atividade;
    assert.equal(depois.status, 'pendente', 'volta para a fila');
    assert.equal(depois.horas, 8, 'as 6 h declaradas mais as 2 h de correção');
    assert.equal(depois.horas_revisao, 2);
    assert.match(depois.motivo, /Falta anexar o certificado/,
      'o que o professor pediu continua no registro, para ele conferir');
    assert.ok(depois.arquivo_id, 'o arquivo novo entrou');

    // A professora é avisada, com o tempo de correção no corpo.
    assert.match(email.enviados.at(-1).assunto, /Correção reenviada.*Ana Ribeiro/);
    assert.match(email.enviados.at(-1).texto, /Tempo de correção informado: 2 h/);
    assert.match(email.enviados.at(-1).texto, /Total declarado agora: 8 h/);

    // Reenviar duas vezes soma; e não dá para reenviar o que não foi devolvido.
    assert.equal((await ana(`/api/atividades/${id}/reenviar`, {
      metodo: 'POST', corpo: { horas_revisao: 1 },
    })).status, 409);

    await admin(`/api/atividades/${id}/analise`, {
      metodo: 'POST', corpo: { status: 'correcao', motivo: 'Mais uma coisa.' },
    });
    const segunda = await ana(`/api/atividades/${id}/reenviar`, { metodo: 'POST', corpo: { horas_revisao: 1 } });
    assert.equal(segunda.dados.atividade.horas, 9);
    assert.equal(segunda.dados.atividade.horas_revisao, 3, 'o tempo de correção acumula');

    // A atividade de outro aluno segue fora de alcance.
    const bruno = await criarAluno(base, 'Bruno', 'bruno@ex.br', turma.codigo);
    assert.equal((await bruno(`/api/atividades/${id}/reenviar`, {
      metodo: 'POST', corpo: { horas_revisao: 1 },
    })).status, 403);
  });
});
