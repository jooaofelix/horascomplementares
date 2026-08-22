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

function validarAtividade(corpo) {
  const titulo = texto(corpo.titulo, 'o título da atividade', { max: 200 });
  const categoria = texto(corpo.categoria, 'a categoria');
  if (!CATEGORIAS.includes(categoria)) throw erro(400, 'Categoria inválida.');

  const data = texto(corpo.data_atividade, 'a data da atividade', { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data))) {
    throw erro(400, 'Data inválida — use o formato AAAA-MM-DD.');
  }

  const horas = Number(corpo.horas);
  if (!Number.isFinite(horas) || horas <= 0) throw erro(400, 'As horas devem ser um número maior que zero.');
  if (horas > 1000) throw erro(400, 'Máximo de 1000 horas por registro.');

  const analise = typeof corpo.texto === 'string' ? corpo.texto : '';
  if (analise.length > LIMITE_TEXTO) {
    throw erro(400, `A análise passa de ${LIMITE_TEXTO.toLocaleString('pt-BR')} caracteres.`);
  }

  return {
    titulo,
    categoria,
    data_atividade: data,
    horas: Math.round(horas * 100) / 100,
    texto: analise,
    arquivo_nome: texto(corpo.arquivo_nome, 'o nome do arquivo', { obrigatorio: false, max: 255 }) || null,
  };
}

// ---------- consultas ----------

const COLUNAS_ATIVIDADE = `a.id, a.usuario_id, a.titulo, a.categoria, a.data_atividade, a.horas,
  a.texto, a.arquivo_nome, a.validado, a.validado_em, a.observacao, a.criado_em, a.atualizado_em,
  u.nome AS aluno_nome, v.nome AS validado_por_nome`;

const JUNCOES = `FROM atividades a
  JOIN usuarios u ON u.id = a.usuario_id
  LEFT JOIN usuarios v ON v.id = a.validado_por`;

const buscarAtividade = (bd, id) =>
  bd.get(`SELECT ${COLUNAS_ATIVIDADE} ${JUNCOES} WHERE a.id = ?`, id);

function listarAtividades(bd, { usuarioId = null } = {}) {
  const sql = `SELECT ${COLUNAS_ATIVIDADE} ${JUNCOES}
    ${usuarioId ? 'WHERE a.usuario_id = ?' : ''}
    ORDER BY a.data_atividade DESC, a.id DESC`;
  return usuarioId ? bd.all(sql, usuarioId) : bd.all(sql);
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
    meta: Number(await lerConfig(bd, 'meta_horas')),
  };
}

function exigirProfessor(usuario) {
  if (!usuario || usuario.papel !== 'professor') throw erro(403, 'Só o professor pode fazer isso.');
}

function paraCsv(linhas) {
  const cabecalho = [
    'aluno', 'data', 'titulo', 'categoria', 'horas', 'validado',
    'validado_por', 'observacao', 'caracteres_analise', 'arquivo',
  ];
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const corpo = linhas.map((a) =>
    [
      a.aluno_nome, a.data_atividade, a.titulo, a.categoria,
      String(a.horas).replace('.', ','),
      a.validado ? 'sim' : 'não',
      a.validado_por_nome || '', a.observacao || '',
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

      if (await bd.get('SELECT 1 AS existe FROM usuarios WHERE email = ?', email)) {
        throw erro(409, 'Esse e-mail já está cadastrado.');
      }

      const { ultimoId } = await bd.run(
        'INSERT INTO usuarios(nome, email, senha_hash, papel, criado_em) VALUES(?, ?, ?, ?, ?)',
        nome,
        email,
        await gerarHash(senha, iteracoesSenha),
        papel,
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

    ['GET', /^\/api\/eu$/, async (ctx) => ({
      corpo: {
        usuario: ctx.usuario,
        categorias: CATEGORIAS,
        meta_horas: Number(await lerConfig(bd, 'meta_horas')),
        titulo_turma: await lerConfig(bd, 'titulo_turma'),
        resumo: ctx.usuario && ctx.usuario.papel === 'aluno' ? await resumo(bd, ctx.usuario.id) : null,
      },
    })],

    ['GET', /^\/api\/atividades$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const alvo = ctx.url.searchParams.get('usuario_id');
      if (usuario.papel === 'professor') {
        return { corpo: { atividades: await listarAtividades(bd, { usuarioId: alvo ? Number(alvo) : null }) } };
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
      const dados = validarAtividade(ctx.corpo);
      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        `INSERT INTO atividades
           (usuario_id, titulo, categoria, data_atividade, horas, texto, arquivo_nome, criado_em, atualizado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        usuario.id, dados.titulo, dados.categoria, dados.data_atividade,
        dados.horas, dados.texto, dados.arquivo_nome, agora, agora,
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

      const dados = validarAtividade(ctx.corpo);
      // Editar o conteúdo derruba o selo do professor: ele revalida a versão nova.
      await bd.run(
        `UPDATE atividades
            SET titulo = ?, categoria = ?, data_atividade = ?, horas = ?, texto = ?, arquivo_nome = ?,
                validado = 0, validado_por = NULL, validado_em = NULL, atualizado_em = ?
          WHERE id = ?`,
        dados.titulo, dados.categoria, dados.data_atividade, dados.horas,
        dados.texto, dados.arquivo_nome, new Date().toISOString(), atual.id,
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
      const linhas = await bd.all(
        `SELECT u.id, u.nome, u.email,
                COUNT(a.id) AS registros,
                COALESCE(SUM(a.horas), 0) AS declarado,
                COALESCE(SUM(CASE WHEN a.validado = 1 THEN a.horas ELSE 0 END), 0) AS validado,
                COALESCE(SUM(CASE WHEN a.validado = 0 THEN 1 ELSE 0 END), 0) AS pendentes
           FROM usuarios u
           LEFT JOIN atividades a ON a.usuario_id = u.id
          WHERE u.papel = 'aluno'
          GROUP BY u.id
          ORDER BY u.nome COLLATE NOCASE`,
      );
      const alunos = linhas.map((l) => ({
        ...l,
        declarado: Math.round(l.declarado * 100) / 100,
        validado: Math.round(l.validado * 100) / 100,
      }));
      return { corpo: { alunos, meta_horas: Number(await lerConfig(bd, 'meta_horas')) } };
    }],

    ['PUT', /^\/api\/config$/, async (ctx) => {
      exigirProfessor(ctx.exigirLogin());
      if (ctx.corpo.meta_horas !== undefined) {
        const meta = Number(ctx.corpo.meta_horas);
        if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
        await gravarConfig(bd, 'meta_horas', meta);
      }
      if (ctx.corpo.titulo_turma !== undefined) {
        await gravarConfig(bd, 'titulo_turma', texto(ctx.corpo.titulo_turma, 'o nome da turma', { max: 160 }));
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
      const linhas =
        usuario.papel === 'professor'
          ? await listarAtividades(bd)
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
