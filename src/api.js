// Rotas e regras do sistema. Este arquivo não conhece o runtime: recebe um
// banco já adaptado (SQLite local ou D1) e devolve descrições de resposta.

import {
  gerarHash,
  conferirSenha,
  criarSessao,
  encerrarSessao,
  cookieDeSessao,
  ITERACOES_PADRAO,
} from './auth.js';

const LIMITE_TEXTO = 200_000;

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

// ---------- config ----------

async function lerConfig(bd, chave) {
  const linha = await bd.get('SELECT valor FROM config WHERE chave = ?', chave);
  return linha ? linha.valor : null;
}

async function gravarConfig(bd, chave, valor) {
  await bd.run(
    'INSERT INTO config(chave, valor) VALUES(?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor',
    chave,
    String(valor),
  );
}

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

// ---------- consultas ----------

const COLUNAS_ATIVIDADE = `a.id, a.usuario_id, a.titulo, a.categoria, a.local, a.responsavel,
  a.data_atividade, a.data_fim, a.horas, a.comprovante, a.texto, a.arquivo_nome,
  a.validado, a.validado_em, a.observacao, a.criado_em, a.atualizado_em,
  u.nome AS aluno_nome, u.matricula AS aluno_matricula, t.nome AS turma_nome,
  v.nome AS validado_por_nome`;

const JUNCOES = `FROM atividades a
  JOIN usuarios u ON u.id = a.usuario_id
  LEFT JOIN turmas t ON t.id = u.turma_id
  LEFT JOIN usuarios v ON v.id = a.validado_por`;

const buscarAtividade = (bd, id) =>
  bd.get(`SELECT ${COLUNAS_ATIVIDADE} ${JUNCOES} WHERE a.id = ?`, id);

function listarAtividades(bd, { usuarioId = null, turmaId = null } = {}) {
  const ordem = 'ORDER BY a.data_atividade DESC, a.id DESC';
  if (usuarioId) {
    return bd.all(`SELECT ${COLUNAS_ATIVIDADE} ${JUNCOES} WHERE a.usuario_id = ? ${ordem}`, usuarioId);
  }
  if (turmaId) {
    return bd.all(`SELECT ${COLUNAS_ATIVIDADE} ${JUNCOES} WHERE u.turma_id = ? ${ordem}`, turmaId);
  }
  return bd.all(`SELECT ${COLUNAS_ATIVIDADE} ${JUNCOES} ${ordem}`);
}

async function metaDoUsuario(bd, usuarioId) {
  const linha = await bd.get(
    `SELECT t.meta_horas AS meta
       FROM usuarios u LEFT JOIN turmas t ON t.id = u.turma_id
      WHERE u.id = ?`,
    usuarioId,
  );
  if (linha && linha.meta !== null && linha.meta !== undefined) return Number(linha.meta);
  return Number(await lerConfig(bd, 'meta_horas'));
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
}

const listarTurmas = (bd) =>
  bd.all(`SELECT t.id, t.nome, t.periodo, t.meta_horas,
                 (SELECT COUNT(*) FROM usuarios u WHERE u.turma_id = t.id AND u.papel = 'aluno') AS alunos
            FROM turmas t ORDER BY t.nome COLLATE NOCASE`);

async function turmaValida(bd, valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw erro(400, 'Turma inválida.');
  if (!(await bd.get('SELECT 1 AS existe FROM turmas WHERE id = ?', id))) {
    throw erro(400, 'Essa turma não existe.');
  }
  return id;
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
  const codigoProfessor = opcoes.codigoProfessor || 'tecnicas-de-observacao';
  const iteracoesSenha = Number(opcoes.iteracoesSenha) || ITERACOES_PADRAO;

  return [
    ['POST', /^\/api\/cadastro$/, async (ctx) => {
      const nome = texto(ctx.corpo.nome, 'seu nome', { max: 120 });
      const email = texto(ctx.corpo.email, 'seu e-mail', { max: 160 }).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro(400, 'E-mail inválido.');
      const senha = typeof ctx.corpo.senha === 'string' ? ctx.corpo.senha : '';
      if (senha.length < 6) throw erro(400, 'A senha precisa de pelo menos 6 caracteres.');

      const codigo = texto(ctx.corpo.codigo_professor, 'o código', { obrigatorio: false, max: 100 });
      let papel = 'aluno';
      if (codigo) {
        if (codigo !== codigoProfessor) throw erro(400, 'Código de professor incorreto.');
        papel = 'professor';
      }

      const turmaId = papel === 'aluno' ? await turmaValida(bd, ctx.corpo.turma_id) : null;
      const matricula = texto(ctx.corpo.matricula, 'a matrícula', { obrigatorio: false, max: 40 }) || null;

      if (await bd.get('SELECT 1 AS existe FROM usuarios WHERE email = ?', email)) {
        throw erro(409, 'Esse e-mail já está cadastrado. Use "Entrar" ou outro e-mail.');
      }

      const { ultimoId } = await bd.run(
        `INSERT INTO usuarios(nome, email, senha_hash, papel, turma_id, matricula, criado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
        nome,
        email,
        await gerarHash(senha, iteracoesSenha),
        papel,
        turmaId,
        matricula,
        new Date().toISOString(),
      );

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

    // Lista pública: a tela de cadastro precisa oferecer as turmas.
    ['GET', /^\/api\/turmas$/, async () => ({
      corpo: { turmas: await listarTurmas(bd) },
    })],

    ['POST', /^\/api\/turmas$/, async (ctx) => {
      exigirProfessor(ctx.exigirLogin());
      const nome = texto(ctx.corpo.nome, 'o nome da turma', { max: 120 });
      const periodo = texto(ctx.corpo.periodo, 'o período', { obrigatorio: false, max: 60 }) || null;
      const meta = Number(ctx.corpo.meta_horas);
      if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
      const { ultimoId } = await bd.run(
        'INSERT INTO turmas(nome, periodo, meta_horas, criado_em) VALUES(?, ?, ?, ?)',
        nome, periodo, meta, new Date().toISOString(),
      );
      return { status: 201, corpo: { turma: await bd.get('SELECT * FROM turmas WHERE id = ?', ultimoId) } };
    }],

    ['PUT', /^\/api\/turmas\/(\d+)$/, async (ctx) => {
      exigirProfessor(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await bd.get('SELECT 1 AS existe FROM turmas WHERE id = ?', id))) {
        throw erro(404, 'Turma não encontrada.');
      }
      const nome = texto(ctx.corpo.nome, 'o nome da turma', { max: 120 });
      const periodo = texto(ctx.corpo.periodo, 'o período', { obrigatorio: false, max: 60 }) || null;
      const meta = Number(ctx.corpo.meta_horas);
      if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
      await bd.run('UPDATE turmas SET nome = ?, periodo = ?, meta_horas = ? WHERE id = ?', nome, periodo, meta, id);
      return { corpo: { turma: await bd.get('SELECT * FROM turmas WHERE id = ?', id) } };
    }],

    ['DELETE', /^\/api\/turmas\/(\d+)$/, async (ctx) => {
      exigirProfessor(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      const comAlunos = await bd.get('SELECT COUNT(*) AS total FROM usuarios WHERE turma_id = ?', id);
      if (comAlunos.total > 0) {
        throw erro(409, `Essa turma tem ${comAlunos.total} aluno(s). Mova-os antes de excluir.`);
      }
      await bd.run('DELETE FROM turmas WHERE id = ?', id);
      return { corpo: { ok: true } };
    }],

    ['GET', /^\/api\/eu$/, async (ctx) => ({
      corpo: {
        usuario: ctx.usuario,
        categorias: CATEGORIAS,
        titulo_turma: await lerConfig(bd, 'titulo_turma'),
        meta_horas: Number(await lerConfig(bd, 'meta_horas')),
        turmas: await listarTurmas(bd),
        resumo: ctx.usuario && ctx.usuario.papel === 'aluno' ? await resumo(bd, ctx.usuario.id) : null,
      },
    })],

    // O aluno corrige a própria turma e matrícula.
    ['PUT', /^\/api\/eu$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const turmaId = await turmaValida(bd, ctx.corpo.turma_id);
      const matricula = texto(ctx.corpo.matricula, 'a matrícula', { obrigatorio: false, max: 40 }) || null;
      await bd.run('UPDATE usuarios SET turma_id = ?, matricula = ? WHERE id = ?', turmaId, matricula, usuario.id);
      return { corpo: { ok: true, resumo: await resumo(bd, usuario.id) } };
    }],

    ['GET', /^\/api\/atividades$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      if (usuario.papel === 'professor') {
        const turmaId = ctx.url.searchParams.get('turma_id');
        const alvo = ctx.url.searchParams.get('usuario_id');
        return {
          corpo: {
            atividades: await listarAtividades(bd, {
              usuarioId: alvo ? Number(alvo) : null,
              turmaId: turmaId ? Number(turmaId) : null,
            }),
          },
        };
      }
      return {
        corpo: {
          atividades: await listarAtividades(bd, { usuarioId: usuario.id }),
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
      if (atual.usuario_id !== usuario.id && usuario.papel !== 'professor') {
        throw erro(403, 'Essa atividade é de outro aluno.');
      }
      await bd.run('DELETE FROM atividades WHERE id = ?', atual.id);
      return { corpo: { ok: true, resumo: await resumo(bd, atual.usuario_id) } };
    }],

    ['POST', /^\/api\/atividades\/(\d+)\/validacao$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      exigirProfessor(usuario);
      const atual = await buscarAtividade(bd, Number(ctx.parametros[0]));
      if (!atual) throw erro(404, 'Atividade não encontrada.');

      const validado = ctx.corpo.validado ? 1 : 0;
      const observacao =
        texto(ctx.corpo.observacao, 'a observação', { obrigatorio: false, max: 2000 }) || null;
      const agora = new Date().toISOString();
      await bd.run(
        `UPDATE atividades
            SET validado = ?, validado_por = ?, validado_em = ?, observacao = ?, atualizado_em = ?
          WHERE id = ?`,
        validado,
        validado ? usuario.id : null,
        validado ? agora : null,
        observacao,
        agora,
        atual.id,
      );
      return { corpo: { atividade: await buscarAtividade(bd, atual.id) } };
    }],

    ['GET', /^\/api\/turma$/, async (ctx) => {
      exigirProfessor(ctx.exigirLogin());
      const filtro = ctx.url.searchParams.get('turma_id');
      const padrao = Number(await lerConfig(bd, 'meta_horas'));
      const linhas = await bd.all(
        `SELECT u.id, u.nome, u.email, u.matricula, u.turma_id, t.nome AS turma_nome, t.meta_horas,
                COUNT(a.id) AS registros,
                COALESCE(SUM(a.horas), 0) AS declarado,
                COALESCE(SUM(CASE WHEN a.validado = 1 THEN a.horas ELSE 0 END), 0) AS validado,
                COALESCE(SUM(CASE WHEN a.validado = 0 THEN 1 ELSE 0 END), 0) AS pendentes
           FROM usuarios u
           LEFT JOIN turmas t ON t.id = u.turma_id
           LEFT JOIN atividades a ON a.usuario_id = u.id
          WHERE u.papel = 'aluno' ${filtro ? 'AND u.turma_id = ?' : ''}
          GROUP BY u.id
          ORDER BY u.nome COLLATE NOCASE`,
        ...(filtro ? [Number(filtro)] : []),
      );
      const alunos = linhas.map((l) => ({
        ...l,
        declarado: Math.round(l.declarado * 100) / 100,
        validado: Math.round(l.validado * 100) / 100,
        meta: l.meta_horas === null || l.meta_horas === undefined ? padrao : Number(l.meta_horas),
      }));
      return { corpo: { alunos, turmas: await listarTurmas(bd), meta_horas: padrao } };
    }],

    ['PUT', /^\/api\/config$/, async (ctx) => {
      exigirProfessor(ctx.exigirLogin());
      if (ctx.corpo.meta_horas !== undefined) {
        const meta = Number(ctx.corpo.meta_horas);
        if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
        await gravarConfig(bd, 'meta_horas', meta);
      }
      if (ctx.corpo.titulo_turma !== undefined) {
        await gravarConfig(bd, 'titulo_turma', texto(ctx.corpo.titulo_turma, 'o título', { max: 160 }));
      }
      return {
        corpo: {
          meta_horas: Number(await lerConfig(bd, 'meta_horas')),
          titulo_turma: await lerConfig(bd, 'titulo_turma'),
        },
      };
    }],

    ['GET', /^\/api\/exportar\.csv$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const turmaId = ctx.url.searchParams.get('turma_id');
      const linhas =
        usuario.papel === 'professor'
          ? await listarAtividades(bd, { turmaId: turmaId ? Number(turmaId) : null })
          : await listarAtividades(bd, { usuarioId: usuario.id });
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
