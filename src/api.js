// Rotas e regras do sistema. Este arquivo não conhece o runtime: recebe um
// banco já adaptado (SQLite local ou D1) e devolve descrições de resposta.
//
// Regra central: cada professor é dono das próprias turmas. Ele só enxerga e
// valida os alunos das turmas dele; o aluno entra numa turma pelo código.

import {
  gerarHash,
  conferirSenha,
  criarSessao,
  encerrarSessao,
  cookieDeSessao,
  ITERACOES_PADRAO,
} from './auth.js';

const LIMITE_TEXTO = 200_000;
const META_PADRAO = 200;

export const CATEGORIAS = [
  'Observação em campo',
  'Registro cursivo',
  'Análise de material',
  'Leitura / fichamento',
  'Supervisão',
  'Seminário / evento',
  'Extensão / projeto',
  'Outro',
];

export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const erro = (status, mensagem) => new ErroHttp(status, mensagem);

// ---------- validação ----------

function texto(valor, campo, { obrigatorio = true, max = 200 } = {}) {
  const v = typeof valor === 'string' ? valor.trim() : '';
  if (!v && obrigatorio) throw erro(400, `Informe ${campo}.`);
  if (v.length > max) throw erro(400, `${campo} passa de ${max} caracteres.`);
  return v;
}

function data(valor, campo, { obrigatorio = true } = {}) {
  const v = texto(valor, campo, { obrigatorio, max: 10 });
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw erro(400, `${campo} está em formato inválido — use AAAA-MM-DD.`);
  }
  return v;
}

function validarAtividade(corpo) {
  const titulo = texto(corpo.titulo, 'o nome da atividade', { max: 200 });
  const categoria = texto(corpo.categoria, 'a categoria');
  if (!CATEGORIAS.includes(categoria)) throw erro(400, 'Categoria inválida.');

  const inicio = data(corpo.data_atividade, 'a data da atividade');
  const fim = data(corpo.data_fim, 'a data de término', { obrigatorio: false });
  if (fim && fim < inicio) throw erro(400, 'A data de término é anterior à data de início.');

  const horas = Number(corpo.horas);
  if (!Number.isFinite(horas) || horas <= 0) throw erro(400, 'As horas devem ser um número maior que zero.');
  if (horas > 1000) throw erro(400, 'Máximo de 1000 horas por registro.');

  const analise = typeof corpo.texto === 'string' ? corpo.texto : '';
  if (analise.length > LIMITE_TEXTO) {
    throw erro(400, `A análise passa de ${LIMITE_TEXTO.toLocaleString('pt-BR')} caracteres.`);
  }

  const opcional = (valor, campo, max) => texto(valor, campo, { obrigatorio: false, max }) || null;

  return {
    titulo,
    categoria,
    local: opcional(corpo.local, 'o local', 160),
    responsavel: opcional(corpo.responsavel, 'o responsável', 120),
    data_atividade: inicio,
    data_fim: fim,
    horas: Math.round(horas * 100) / 100,
    comprovante: opcional(corpo.comprovante, 'o comprovante', 300),
    texto: analise,
    arquivo_nome: opcional(corpo.arquivo_nome, 'o nome do arquivo', 255),
  };
}

// ---------- turmas ----------

// Sem 0/O e 1/I: o código é ditado em sala e digitado no celular.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function gerarCodigo(bd, tabela, tamanho) {
  for (let tentativa = 0; tentativa < 12; tentativa++) {
    const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
    const codigo = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
    if (!(await bd.get(`SELECT 1 AS existe FROM ${tabela} WHERE codigo = ?`, codigo))) return codigo;
  }
  throw erro(500, 'Não foi possível gerar um código.');
}

const gerarCodigoTurma = (bd) => gerarCodigo(bd, 'turmas', 6);
// Convite é mais longo: ele vale para criar uma conta de professor.
const gerarCodigoConvite = (bd) => gerarCodigo(bd, 'convites', 10);

const exigirConvidador = (usuario) => {
  exigirProfessor(usuario);
  if (!usuario.pode_convidar) throw erro(403, 'Sua conta não pode gerar convites.');
  return usuario;
};

const normalizarCodigo = (valor, rotulo = 'o código da turma') =>
  texto(valor, rotulo, { obrigatorio: false, max: 16 }).toUpperCase().replace(/[^A-Z0-9]/g, '');

const turmasDoProfessor = (bd, professorId) =>
  bd.all(
    `SELECT t.id, t.nome, t.periodo, t.codigo, t.meta_horas,
            (SELECT COUNT(*) FROM usuarios u WHERE u.turma_id = t.id AND u.papel = 'aluno') AS alunos
       FROM turmas t WHERE t.professor_id = ? ORDER BY t.nome COLLATE NOCASE`,
    professorId,
  );

const turmaPropria = (bd, id, professorId) =>
  bd.get('SELECT * FROM turmas WHERE id = ? AND professor_id = ?', id, professorId);

async function turmaPorCodigo(bd, codigo) {
  if (!codigo) return null;
  const turma = await bd.get(
    `SELECT t.id, t.nome, t.periodo, t.meta_horas, p.nome AS professor_nome, p.instituicao
       FROM turmas t LEFT JOIN usuarios p ON p.id = t.professor_id
      WHERE t.codigo = ?`,
    codigo,
  );
  if (!turma) throw erro(404, 'Nenhuma turma com esse código. Confira com o professor.');
  return turma;
}

// ---------- consultas ----------

const COLUNAS_ATIVIDADE = `a.id, a.usuario_id, a.titulo, a.categoria, a.local, a.responsavel,
  a.data_atividade, a.data_fim, a.horas, a.comprovante, a.texto, a.arquivo_nome,
  a.validado, a.validado_em, a.observacao, a.criado_em, a.atualizado_em,
  u.nome AS aluno_nome, u.matricula AS aluno_matricula, t.nome AS turma_nome,
  v.nome AS validado_por_nome`;

const juncoes = (interna) => `FROM atividades a
  JOIN usuarios u ON u.id = a.usuario_id
  ${interna ? 'JOIN' : 'LEFT JOIN'} turmas t ON t.id = u.turma_id
  LEFT JOIN usuarios v ON v.id = a.validado_por`;

const ORDEM = 'ORDER BY a.data_atividade DESC, a.id DESC';

const atividadesDoAluno = (bd, usuarioId) =>
  bd.all(`SELECT ${COLUNAS_ATIVIDADE} ${juncoes(false)} WHERE a.usuario_id = ? ${ORDEM}`, usuarioId);

const atividadesDoProfessor = (bd, professorId, turmaId) =>
  turmaId
    ? bd.all(
        `SELECT ${COLUNAS_ATIVIDADE} ${juncoes(true)} WHERE t.professor_id = ? AND t.id = ? ${ORDEM}`,
        professorId, turmaId,
      )
    : bd.all(
        `SELECT ${COLUNAS_ATIVIDADE} ${juncoes(true)} WHERE t.professor_id = ? ${ORDEM}`,
        professorId,
      );

const atividadeVisivelAoProfessor = (bd, atividadeId, professorId) =>
  bd.get(
    `SELECT a.id FROM atividades a
       JOIN usuarios u ON u.id = a.usuario_id
       JOIN turmas t ON t.id = u.turma_id
      WHERE a.id = ? AND t.professor_id = ?`,
    atividadeId, professorId,
  );

const buscarAtividade = (bd, id) =>
  bd.get(`SELECT ${COLUNAS_ATIVIDADE} ${juncoes(false)} WHERE a.id = ?`, id);

async function metaDoUsuario(bd, usuarioId) {
  const linha = await bd.get(
    `SELECT t.meta_horas AS meta FROM usuarios u
       LEFT JOIN turmas t ON t.id = u.turma_id WHERE u.id = ?`,
    usuarioId,
  );
  return linha && linha.meta !== null && linha.meta !== undefined ? Number(linha.meta) : META_PADRAO;
}

async function resumo(bd, usuarioId) {
  const linha = await bd.get(
    `SELECT COUNT(*) AS registros,
            COALESCE(SUM(horas), 0) AS declarado,
            COALESCE(SUM(CASE WHEN validado = 1 THEN horas ELSE 0 END), 0) AS validado,
            COALESCE(SUM(CASE WHEN validado = 0 THEN 1 ELSE 0 END), 0) AS pendentes
       FROM atividades WHERE usuario_id = ?`,
    usuarioId,
  );
  return {
    registros: linha.registros,
    declarado: Math.round(linha.declarado * 100) / 100,
    validado: Math.round(linha.validado * 100) / 100,
    pendentes: linha.pendentes,
    meta: await metaDoUsuario(bd, usuarioId),
  };
}

function exigirProfessor(usuario) {
  if (!usuario || usuario.papel !== 'professor') throw erro(403, 'Só o professor pode fazer isso.');
  return usuario;
}

function paraCsv(linhas) {
  const cabecalho = [
    'aluno', 'matricula', 'turma', 'data_inicio', 'data_fim', 'atividade', 'categoria',
    'local', 'responsavel', 'horas', 'validado', 'validado_por', 'observacao',
    'comprovante', 'caracteres_analise', 'arquivo',
  ];
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const corpo = linhas.map((a) =>
    [
      a.aluno_nome, a.aluno_matricula || '', a.turma_nome || '',
      a.data_atividade, a.data_fim || '', a.titulo, a.categoria,
      a.local || '', a.responsavel || '',
      String(a.horas).replace('.', ','),
      a.validado ? 'sim' : 'não',
      a.validado_por_nome || '', a.observacao || '', a.comprovante || '',
      (a.texto || '').length, a.arquivo_nome || '',
    ]
      .map(escapar)
      .join(';'),
  );
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n') + '\r\n';
}

// ---------- rotas ----------

export function criarRotas(bd, opcoes = {}) {
  const iteracoesSenha = Number(opcoes.iteracoesSenha) || ITERACOES_PADRAO;

  return [
    ['POST', /^\/api\/cadastro$/, async (ctx) => {
      const nome = texto(ctx.corpo.nome, 'seu nome', { max: 120 });
      const email = texto(ctx.corpo.email, 'seu e-mail', { max: 160 }).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro(400, 'E-mail inválido.');
      const senha = typeof ctx.corpo.senha === 'string' ? ctx.corpo.senha : '';
      if (senha.length < 6) throw erro(400, 'A senha precisa de pelo menos 6 caracteres.');

      const papel = ctx.corpo.papel === 'professor' ? 'professor' : 'aluno';
      let turmaId = null;
      let convite = null;
      let podeConvidar = 0;

      if (papel === 'aluno') {
        const codigo = normalizarCodigo(ctx.corpo.codigo_turma);
        if (!codigo) throw erro(400, 'Informe o código da turma que o professor passou.');
        turmaId = (await turmaPorCodigo(bd, codigo)).id;
      } else {
        // O primeiro professor da instalação entra sem convite — não haveria
        // quem o convidasse. Daí em diante, só com convite de uso único.
        const { total } = await bd.get("SELECT COUNT(*) AS total FROM usuarios WHERE papel = 'professor'");
        if (total === 0) {
          podeConvidar = 1;
        } else {
          const codigo = normalizarCodigo(ctx.corpo.codigo_convite, 'o código do convite');
          if (!codigo) throw erro(400, 'Criar conta de professor exige um convite. Peça o código a quem já usa o sistema.');
          convite = await bd.get('SELECT * FROM convites WHERE codigo = ?', codigo);
          if (!convite) throw erro(404, 'Convite não encontrado. Confira o código.');
          if (convite.usado_por) throw erro(409, 'Esse convite já foi usado.');
        }
      }

      const instituicao =
        papel === 'professor'
          ? texto(ctx.corpo.instituicao, 'a instituição', { obrigatorio: false, max: 160 }) || null
          : null;
      const matricula = texto(ctx.corpo.matricula, 'a matrícula', { obrigatorio: false, max: 40 }) || null;

      if (await bd.get('SELECT 1 AS existe FROM usuarios WHERE email = ?', email)) {
        throw erro(409, 'Esse e-mail já está cadastrado. Use "Entrar" ou outro e-mail.');
      }

      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        `INSERT INTO usuarios(nome, email, senha_hash, papel, turma_id, matricula, instituicao, pode_convidar, criado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nome, email, await gerarHash(senha, iteracoesSenha), papel,
        turmaId, matricula, instituicao, podeConvidar, agora,
      );

      if (convite) {
        await bd.run('UPDATE convites SET usado_por = ?, usado_em = ? WHERE id = ?', ultimoId, agora, convite.id);
      }

      const { token, expira } = await criarSessao(bd, ultimoId);
      return {
        corpo: { usuario: { id: ultimoId, nome, email, papel } },
        cabecalhos: { 'Set-Cookie': cookieDeSessao(token, expira, ctx.seguro) },
      };
    }],

    ['POST', /^\/api\/login$/, async (ctx) => {
      const email = texto(ctx.corpo.email, 'seu e-mail', { max: 160 }).toLowerCase();
      const senha = typeof ctx.corpo.senha === 'string' ? ctx.corpo.senha : '';
      const usuario = await bd.get('SELECT * FROM usuarios WHERE email = ?', email);
      if (!usuario || !(await conferirSenha(senha, usuario.senha_hash))) {
        throw erro(401, 'E-mail ou senha incorretos.');
      }
      const { token, expira } = await criarSessao(bd, usuario.id);
      return {
        corpo: {
          usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
        },
        cabecalhos: { 'Set-Cookie': cookieDeSessao(token, expira, ctx.seguro) },
      };
    }],

    ['POST', /^\/api\/logout$/, async (ctx) => {
      await encerrarSessao(bd, ctx.token);
      return { corpo: { ok: true }, cabecalhos: { 'Set-Cookie': cookieDeSessao('', null, ctx.seguro) } };
    }],

    // Confere um código antes do cadastro: mostra em qual turma o aluno vai entrar.
    ['POST', /^\/api\/turmas\/localizar$/, async (ctx) => {
      const codigo = normalizarCodigo(ctx.corpo.codigo);
      if (!codigo) throw erro(400, 'Informe o código da turma.');
      return { corpo: { turma: await turmaPorCodigo(bd, codigo) } };
    }],

    ['GET', /^\/api\/turmas$/, async (ctx) => {
      const professor = exigirProfessor(ctx.exigirLogin());
      return { corpo: { turmas: await turmasDoProfessor(bd, professor.id) } };
    }],

    ['POST', /^\/api\/turmas$/, async (ctx) => {
      const professor = exigirProfessor(ctx.exigirLogin());
      const nome = texto(ctx.corpo.nome, 'o nome da turma', { max: 120 });
      const periodo = texto(ctx.corpo.periodo, 'o período', { obrigatorio: false, max: 60 }) || null;
      const meta = Number(ctx.corpo.meta_horas);
      if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
      const { ultimoId } = await bd.run(
        'INSERT INTO turmas(nome, periodo, codigo, professor_id, meta_horas, criado_em) VALUES(?, ?, ?, ?, ?, ?)',
        nome, periodo, await gerarCodigoTurma(bd), professor.id, meta, new Date().toISOString(),
      );
      return { status: 201, corpo: { turma: await bd.get('SELECT * FROM turmas WHERE id = ?', ultimoId) } };
    }],

    ['PUT', /^\/api\/turmas\/(\d+)$/, async (ctx) => {
      const professor = exigirProfessor(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await turmaPropria(bd, id, professor.id))) throw erro(404, 'Turma não encontrada.');
      const nome = texto(ctx.corpo.nome, 'o nome da turma', { max: 120 });
      const periodo = texto(ctx.corpo.periodo, 'o período', { obrigatorio: false, max: 60 }) || null;
      const meta = Number(ctx.corpo.meta_horas);
      if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
      await bd.run('UPDATE turmas SET nome = ?, periodo = ?, meta_horas = ? WHERE id = ?', nome, periodo, meta, id);
      return { corpo: { turma: await bd.get('SELECT * FROM turmas WHERE id = ?', id) } };
    }],

    ['DELETE', /^\/api\/turmas\/(\d+)$/, async (ctx) => {
      const professor = exigirProfessor(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await turmaPropria(bd, id, professor.id))) throw erro(404, 'Turma não encontrada.');
      const comAlunos = await bd.get('SELECT COUNT(*) AS total FROM usuarios WHERE turma_id = ?', id);
      if (comAlunos.total > 0) {
        throw erro(409, `Essa turma tem ${comAlunos.total} aluno(s). Mova-os antes de excluir.`);
      }
      await bd.run('DELETE FROM turmas WHERE id = ?', id);
      return { corpo: { ok: true } };
    }],

    // A tela de cadastro precisa saber se já existe professor na instalação.
    ['GET', /^\/api\/convites$/, async (ctx) => {
      const professor = exigirConvidador(ctx.exigirLogin());
      const convites = await bd.all(
        `SELECT c.id, c.codigo, c.observacao, c.criado_em, c.usado_em, u.nome AS usado_por_nome
           FROM convites c LEFT JOIN usuarios u ON u.id = c.usado_por
          WHERE c.criado_por = ? ORDER BY c.id DESC`,
        professor.id,
      );
      return { corpo: { convites } };
    }],

    ['POST', /^\/api\/convites$/, async (ctx) => {
      const professor = exigirConvidador(ctx.exigirLogin());
      const observacao = texto(ctx.corpo.observacao, 'a anotação', { obrigatorio: false, max: 120 }) || null;
      const codigo = await gerarCodigoConvite(bd);
      await bd.run(
        'INSERT INTO convites(codigo, observacao, criado_por, criado_em) VALUES(?, ?, ?, ?)',
        codigo, observacao, professor.id, new Date().toISOString(),
      );
      return { status: 201, corpo: { convite: await bd.get('SELECT * FROM convites WHERE codigo = ?', codigo) } };
    }],

    ['DELETE', /^\/api\/convites\/(\d+)$/, async (ctx) => {
      const professor = exigirConvidador(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      const convite = await bd.get('SELECT * FROM convites WHERE id = ? AND criado_por = ?', id, professor.id);
      if (!convite) throw erro(404, 'Convite não encontrado.');
      if (convite.usado_por) throw erro(409, 'Esse convite já foi usado e não pode ser revogado.');
      await bd.run('DELETE FROM convites WHERE id = ?', id);
      return { corpo: { ok: true } };
    }],

    ['GET', /^\/api\/eu$/, async (ctx) => {
      const usuario = ctx.usuario;
      const corpo = { usuario, categorias: CATEGORIAS };
      if (!usuario) {
        const { total } = await bd.get("SELECT COUNT(*) AS total FROM usuarios WHERE papel = 'professor'");
        corpo.convite_obrigatorio = total > 0;
      }
      if (usuario && usuario.papel === 'aluno') {
        corpo.resumo = await resumo(bd, usuario.id);
        corpo.professor = await bd.get(
          `SELECT p.nome, p.instituicao FROM usuarios u
             JOIN turmas t ON t.id = u.turma_id
             JOIN usuarios p ON p.id = t.professor_id
            WHERE u.id = ?`,
          usuario.id,
        );
      }
      if (usuario && usuario.papel === 'professor') {
        corpo.turmas = await turmasDoProfessor(bd, usuario.id);
      }
      return { corpo };
    }],

    // Aluno entra em outra turma pelo código; professor edita nome e instituição.
    ['PUT', /^\/api\/eu$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const nome = texto(ctx.corpo.nome ?? usuario.nome, 'seu nome', { max: 120 });

      if (usuario.papel === 'professor') {
        const instituicao =
          texto(ctx.corpo.instituicao, 'a instituição', { obrigatorio: false, max: 160 }) || null;
        await bd.run('UPDATE usuarios SET nome = ?, instituicao = ? WHERE id = ?', nome, instituicao, usuario.id);
        return { corpo: { ok: true } };
      }

      const codigo = normalizarCodigo(ctx.corpo.codigo_turma);
      const turmaId = codigo ? (await turmaPorCodigo(bd, codigo)).id : usuario.turma_id;
      const matricula = texto(ctx.corpo.matricula, 'a matrícula', { obrigatorio: false, max: 40 }) || null;
      await bd.run(
        'UPDATE usuarios SET nome = ?, turma_id = ?, matricula = ? WHERE id = ?',
        nome, turmaId, matricula, usuario.id,
      );
      return { corpo: { ok: true, resumo: await resumo(bd, usuario.id) } };
    }],

    ['GET', /^\/api\/atividades$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      if (usuario.papel === 'professor') {
        const turmaId = ctx.url.searchParams.get('turma_id');
        return {
          corpo: {
            atividades: await atividadesDoProfessor(bd, usuario.id, turmaId ? Number(turmaId) : null),
          },
        };
      }
      return {
        corpo: {
          atividades: await atividadesDoAluno(bd, usuario.id),
          resumo: await resumo(bd, usuario.id),
        },
      };
    }],

    ['POST', /^\/api\/atividades$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const d = validarAtividade(ctx.corpo);
      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        `INSERT INTO atividades
           (usuario_id, titulo, categoria, local, responsavel, data_atividade, data_fim,
            horas, comprovante, texto, arquivo_nome, criado_em, atualizado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        usuario.id, d.titulo, d.categoria, d.local, d.responsavel, d.data_atividade, d.data_fim,
        d.horas, d.comprovante, d.texto, d.arquivo_nome, agora, agora,
      );
      return {
        status: 201,
        corpo: { atividade: await buscarAtividade(bd, ultimoId), resumo: await resumo(bd, usuario.id) },
      };
    }],

    ['PUT', /^\/api\/atividades\/(\d+)$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const atual = await buscarAtividade(bd, Number(ctx.parametros[0]));
      if (!atual) throw erro(404, 'Atividade não encontrada.');
      if (atual.usuario_id !== usuario.id) throw erro(403, 'Essa atividade é de outro aluno.');

      const d = validarAtividade(ctx.corpo);
      // Editar o conteúdo derruba o selo do professor: ele revalida a versão nova.
      await bd.run(
        `UPDATE atividades
            SET titulo = ?, categoria = ?, local = ?, responsavel = ?, data_atividade = ?, data_fim = ?,
                horas = ?, comprovante = ?, texto = ?, arquivo_nome = ?,
                validado = 0, validado_por = NULL, validado_em = NULL, atualizado_em = ?
          WHERE id = ?`,
        d.titulo, d.categoria, d.local, d.responsavel, d.data_atividade, d.data_fim,
        d.horas, d.comprovante, d.texto, d.arquivo_nome, new Date().toISOString(), atual.id,
      );
      return { corpo: { atividade: await buscarAtividade(bd, atual.id), resumo: await resumo(bd, usuario.id) } };
    }],

    ['DELETE', /^\/api\/atividades\/(\d+)$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const atual = await buscarAtividade(bd, Number(ctx.parametros[0]));
      if (!atual) throw erro(404, 'Atividade não encontrada.');
      const proprio = atual.usuario_id === usuario.id;
      const daMinhaTurma =
        usuario.papel === 'professor' && (await atividadeVisivelAoProfessor(bd, atual.id, usuario.id));
      if (!proprio && !daMinhaTurma) throw erro(403, 'Essa atividade é de outro aluno.');
      await bd.run('DELETE FROM atividades WHERE id = ?', atual.id);
      return { corpo: { ok: true, resumo: await resumo(bd, atual.usuario_id) } };
    }],

    ['POST', /^\/api\/atividades\/(\d+)\/validacao$/, async (ctx) => {
      const professor = exigirProfessor(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await atividadeVisivelAoProfessor(bd, id, professor.id))) {
        throw erro(404, 'Atividade não encontrada nas suas turmas.');
      }

      const validado = ctx.corpo.validado ? 1 : 0;
      const observacao =
        texto(ctx.corpo.observacao, 'a observação', { obrigatorio: false, max: 2000 }) || null;
      const agora = new Date().toISOString();
      await bd.run(
        `UPDATE atividades
            SET validado = ?, validado_por = ?, validado_em = ?, observacao = ?, atualizado_em = ?
          WHERE id = ?`,
        validado, validado ? professor.id : null, validado ? agora : null, observacao, agora, id,
      );
      return { corpo: { atividade: await buscarAtividade(bd, id) } };
    }],

    ['GET', /^\/api\/turma$/, async (ctx) => {
      const professor = exigirProfessor(ctx.exigirLogin());
      const filtro = ctx.url.searchParams.get('turma_id');
      const parametros = filtro ? [professor.id, Number(filtro)] : [professor.id];
      const linhas = await bd.all(
        `SELECT u.id, u.nome, u.email, u.matricula, u.turma_id, t.nome AS turma_nome, t.meta_horas,
                COUNT(a.id) AS registros,
                COALESCE(SUM(a.horas), 0) AS declarado,
                COALESCE(SUM(CASE WHEN a.validado = 1 THEN a.horas ELSE 0 END), 0) AS validado,
                COALESCE(SUM(CASE WHEN a.validado = 0 THEN 1 ELSE 0 END), 0) AS pendentes
           FROM usuarios u
           JOIN turmas t ON t.id = u.turma_id
           LEFT JOIN atividades a ON a.usuario_id = u.id
          WHERE u.papel = 'aluno' AND t.professor_id = ? ${filtro ? 'AND t.id = ?' : ''}
          GROUP BY u.id
          ORDER BY u.nome COLLATE NOCASE`,
        ...parametros,
      );
      const alunos = linhas.map((l) => ({
        ...l,
        declarado: Math.round(l.declarado * 100) / 100,
        validado: Math.round(l.validado * 100) / 100,
        meta: l.meta_horas === null || l.meta_horas === undefined ? META_PADRAO : Number(l.meta_horas),
      }));
      return { corpo: { alunos, turmas: await turmasDoProfessor(bd, professor.id) } };
    }],

    ['GET', /^\/api\/exportar\.csv$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const turmaId = ctx.url.searchParams.get('turma_id');
      const linhas =
        usuario.papel === 'professor'
          ? await atividadesDoProfessor(bd, usuario.id, turmaId ? Number(turmaId) : null)
          : await atividadesDoAluno(bd, usuario.id);
      return {
        csv: paraCsv(linhas),
        cabecalhos: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="horas-complementares.csv"',
        },
      };
    }],
  ];
}

// Encontra a rota e executa o handler. Compartilhado pelo servidor Node e pelo Worker.
export async function despachar(rotas, ctx) {
  const rota = rotas.find(([metodo, padrao]) => metodo === ctx.metodo && padrao.test(ctx.url.pathname));
  if (!rota) throw new ErroHttp(404, 'Rota não encontrada.');
  ctx.parametros = ctx.url.pathname.match(rota[1]).slice(1);
  return rota[2](ctx);
}
