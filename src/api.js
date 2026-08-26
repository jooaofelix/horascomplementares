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
  sha256Hex,
  comparaTexto,
  ITERACOES_PADRAO,
} from './auth.js';

const LIMITE_TEXTO = 200_000;
const META_PADRAO = 200;
const LIMITE_LOTE = 200;

// Papéis da equipe, do mais restrito ao mais amplo. O professor enxerga as
// turmas dele; o coordenador, os cursos que coordena; o admin, a faculdade.
export const PAPEIS_EQUIPE = ['professor', 'coordenador', 'admin'];

const listarCategorias = (bd) =>
  bd.all('SELECT id, nome, descricao, ordem, ativa FROM categorias ORDER BY ordem, nome COLLATE NOCASE');

const listarCursos = (bd) =>
  bd.all('SELECT id, nome, sigla, horas_obrigatorias, ativo FROM cursos ORDER BY nome COLLATE NOCASE');

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

async function validarAtividade(bd, corpo) {
  const titulo = texto(corpo.titulo, 'o nome da atividade', { max: 200 });

  const categoria = corpo.categoria_id
    ? await bd.get('SELECT id, nome FROM categorias WHERE id = ?', Number(corpo.categoria_id))
    : await bd.get('SELECT id, nome FROM categorias WHERE nome = ?', texto(corpo.categoria, 'a categoria'));
  if (!categoria) throw erro(400, 'Categoria inválida.');

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
    categoria: categoria.nome,
    categoria_id: categoria.id,
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
  exigirEquipe(usuario);
  if (!usuario.pode_convidar) throw erro(403, 'Sua conta não pode gerar convites.');
  return usuario;
};

const normalizarCodigo = (valor, rotulo = 'o código da turma') =>
  texto(valor, rotulo, { obrigatorio: false, max: 16 }).toUpperCase().replace(/[^A-Z0-9]/g, '');

function turmasVisiveis(bd, usuario) {
  const { filtro, parametros } = escopoTurmas(usuario);
  return bd.all(
    `SELECT t.id, t.nome, t.periodo, t.codigo, t.meta_horas, t.curso_id, t.professor_id,
            c.nome AS curso_nome, p.nome AS professor_nome,
            (SELECT COUNT(*) FROM usuarios u WHERE u.turma_id = t.id AND u.papel = 'aluno') AS alunos
       FROM turmas t
       LEFT JOIN cursos c ON c.id = t.curso_id
       LEFT JOIN usuarios p ON p.id = t.professor_id
      WHERE 1 = 1 ${filtro}
      ORDER BY c.nome COLLATE NOCASE, t.nome COLLATE NOCASE`,
    ...parametros,
  );
}

async function turmaVisivel(bd, id, usuario) {
  const { filtro, parametros } = escopoTurmas(usuario);
  return bd.get(`SELECT t.* FROM turmas t WHERE t.id = ? ${filtro}`, id, ...parametros);
}

async function turmaPorCodigo(bd, codigo) {
  if (!codigo) return null;
  const turma = await bd.get(
    `SELECT t.id, t.nome, t.periodo, t.meta_horas, t.curso_id,
            c.nome AS curso_nome, p.nome AS professor_nome, p.instituicao
       FROM turmas t
       LEFT JOIN cursos c ON c.id = t.curso_id
       LEFT JOIN usuarios p ON p.id = t.professor_id
      WHERE t.codigo = ?`,
    codigo,
  );
  if (!turma) throw erro(404, 'Nenhuma turma com esse código. Confira com o professor.');
  return turma;
}

// ---------- chaves de integração ----------

// Formato: hc_<prefixo>_<segredo>. O prefixo viaja em claro e localiza a linha;
// o token inteiro é guardado como hash, então o banco não devolve a chave.
async function criarChave(bd, professorId, nome) {
  const sortear = (n) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALFABETO[b % ALFABETO.length]).join('');
  const prefixo = sortear(8);
  const token = `hc_${prefixo}_${sortear(32)}`;
  await bd.run(
    'INSERT INTO chaves_api(nome, prefixo, segredo_hash, professor_id, criada_em) VALUES(?, ?, ?, ?, ?)',
    nome, prefixo, await sha256Hex(token), professorId, new Date().toISOString(),
  );
  return { token, prefixo };
}

async function professorDaChave(bd, autorizacao) {
  const token = String(autorizacao || '').replace(/^Bearer\s+/i, '').trim();
  const partes = /^hc_([A-Z0-9]{8})_([A-Z0-9]{32})$/.exec(token);
  if (!partes) throw erro(401, 'Envie a chave de integração no cabeçalho Authorization: Bearer hc_...');

  const chave = await bd.get('SELECT * FROM chaves_api WHERE prefixo = ?', partes[1]);
  if (!chave || chave.revogada_em || !comparaTexto(await sha256Hex(token), chave.segredo_hash)) {
    throw erro(401, 'Chave de integração inválida ou revogada.');
  }
  await bd.run(
    'UPDATE chaves_api SET ultimo_uso_em = ?, chamadas = chamadas + 1 WHERE id = ?',
    new Date().toISOString(), chave.id,
  );
  return chave;
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

function atividadesDaEquipe(bd, usuario, turmaId) {
  const { filtro, parametros } = escopoTurmas(usuario);
  const porTurma = turmaId ? 'AND t.id = ?' : '';
  return bd.all(
    `SELECT ${COLUNAS_ATIVIDADE} ${juncoes(true)} WHERE 1 = 1 ${filtro} ${porTurma} ${ORDEM}`,
    ...parametros,
    ...(turmaId ? [turmaId] : []),
  );
}

function atividadeVisivelAEquipe(bd, atividadeId, usuario) {
  const { filtro, parametros } = escopoTurmas(usuario);
  return bd.get(
    `SELECT a.id FROM atividades a
       JOIN usuarios u ON u.id = a.usuario_id
       JOIN turmas t ON t.id = u.turma_id
      WHERE a.id = ? ${filtro}`,
    atividadeId, ...parametros,
  );
}

const buscarAtividade = (bd, id) =>
  bd.get(`SELECT ${COLUNAS_ATIVIDADE} ${juncoes(false)} WHERE a.id = ?`, id);

// A carga obrigatória vem do curso; a meta da turma só vale para quem ainda
// não tem curso (instalações antigas).
async function metaDoUsuario(bd, usuarioId) {
  const linha = await bd.get(
    `SELECT c.horas_obrigatorias AS do_curso, t.meta_horas AS da_turma, u.curso_id
       FROM usuarios u
       LEFT JOIN cursos c ON c.id = u.curso_id
       LEFT JOIN turmas t ON t.id = u.turma_id
      WHERE u.id = ?`,
    usuarioId,
  );
  if (!linha) return META_PADRAO;
  if (linha.do_curso !== null && linha.do_curso !== undefined) return Number(linha.do_curso);
  if (linha.da_turma !== null && linha.da_turma !== undefined) return Number(linha.da_turma);
  return META_PADRAO;
}

// Quanto o aluno já tem em cada categoria e quanto o curso dele permite ali.
async function porCategoria(bd, usuarioId) {
  const linhas = await bd.all(
    `SELECT cat.id, cat.nome, cat.ordem,
            r.limite_horas, r.percentual_max,
            COALESCE(SUM(CASE WHEN a.validado = 1 THEN a.horas ELSE 0 END), 0) AS validado,
            COALESCE(SUM(a.horas), 0) AS declarado
       FROM categorias cat
       LEFT JOIN usuarios u ON u.id = ?
       LEFT JOIN regras_categoria r ON r.categoria_id = cat.id AND r.curso_id = u.curso_id
       LEFT JOIN atividades a ON a.categoria_id = cat.id AND a.usuario_id = u.id
      WHERE cat.ativa = 1
      GROUP BY cat.id
      HAVING r.id IS NOT NULL OR declarado > 0
      ORDER BY cat.ordem, cat.nome COLLATE NOCASE`,
    usuarioId,
  );
  const meta = await metaDoUsuario(bd, usuarioId);
  return linhas.map((l) => {
    const porPercentual =
      l.percentual_max !== null && l.percentual_max !== undefined
        ? (Number(l.percentual_max) / 100) * meta
        : null;
    const limites = [l.limite_horas, porPercentual].filter((v) => v !== null && v !== undefined);
    return {
      id: l.id,
      nome: l.nome,
      validado: Math.round(l.validado * 100) / 100,
      declarado: Math.round(l.declarado * 100) / 100,
      limite: limites.length ? Math.min(...limites.map(Number)) : null,
    };
  });
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
    categorias: await porCategoria(bd, usuarioId),
  };
}

function exigirEquipe(usuario) {
  if (!usuario || !PAPEIS_EQUIPE.includes(usuario.papel)) {
    throw erro(403, 'Só professores e coordenação podem fazer isso.');
  }
  return usuario;
}

function exigirAdmin(usuario) {
  if (!usuario || usuario.papel !== 'admin') throw erro(403, 'Só o administrador pode fazer isso.');
  return usuario;
}

// Recorte de turmas por papel: é o que separa o que cada um enxerga.
function escopoTurmas(usuario) {
  if (usuario.papel === 'admin') return { filtro: '', parametros: [] };
  if (usuario.papel === 'coordenador') {
    return {
      filtro: 'AND t.curso_id IN (SELECT curso_id FROM coordenacoes WHERE usuario_id = ?)',
      parametros: [usuario.id],
    };
  }
  return { filtro: 'AND t.professor_id = ?', parametros: [usuario.id] };
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

// O professor precisa de um curso ao qual a turma pertence; o coordenador só
// pode usar os cursos que coordena.
async function cursoValido(bd, valor, usuario) {
  if (valor === undefined || valor === null || valor === '') return null;
  const curso = await bd.get('SELECT * FROM cursos WHERE id = ?', Number(valor));
  if (!curso) throw erro(400, 'Curso inválido.');
  if (usuario.papel === 'coordenador') {
    const coordena = await bd.get(
      'SELECT 1 AS existe FROM coordenacoes WHERE usuario_id = ? AND curso_id = ?',
      usuario.id, curso.id,
    );
    if (!coordena) throw erro(403, 'Você não coordena esse curso.');
  }
  return curso;
}

// ---------- importação ----------

// Acha o aluno pelo e-mail (ou pela matrícula dentro da turma) e, se ele ainda
// não existe, cria pré-cadastrado: sem senha, já dentro da turma. A conta é
// assumida depois, quando a pessoa se cadastrar com o mesmo e-mail.
async function resolverAluno(bd, turma, dados) {
  const email = texto(dados.email, 'o e-mail do aluno', { obrigatorio: false, max: 160 }).toLowerCase();
  const matricula = texto(dados.matricula, 'a matrícula', { obrigatorio: false, max: 40 }) || null;
  const nome = texto(dados.nome, 'o nome do aluno', { obrigatorio: false, max: 120 }) || null;

  if (!email && !matricula) throw erro(400, 'Informe o e-mail ou a matrícula do aluno.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro(400, `E-mail inválido: ${email}`);

  const achado = email
    ? await bd.get('SELECT * FROM usuarios WHERE email = ?', email)
    : await bd.get(
        "SELECT * FROM usuarios WHERE matricula = ? AND turma_id = ? AND papel = 'aluno'",
        matricula, turma.id,
      );

  if (achado) {
    if (achado.papel !== 'aluno') throw erro(409, `${achado.email} é uma conta de professor.`);
    if (achado.turma_id !== turma.id) {
      const dono = await bd.get('SELECT professor_id FROM turmas WHERE id = ?', achado.turma_id);
      if (dono && dono.professor_id !== turma.professor_id) {
        throw erro(409, `${achado.email || matricula} está numa turma de outro professor.`);
      }
    }
    // Completa o que faltava sem sobrescrever o que o aluno já preencheu.
    await bd.run(
      `UPDATE usuarios
          SET matricula = COALESCE(matricula, ?), nome = CASE WHEN pre_cadastrado = 1 THEN COALESCE(?, nome) ELSE nome END
        WHERE id = ?`,
      matricula, nome, achado.id,
    );
    return { id: achado.id, criado: false };
  }

  if (!email) throw erro(404, `Aluno com matrícula ${matricula} não encontrado nesta turma. Envie o e-mail para criá-lo.`);
  const { ultimoId } = await bd.run(
    `INSERT INTO usuarios(nome, email, senha_hash, papel, turma_id, curso_id, matricula, pre_cadastrado, criado_em)
     VALUES(?, ?, '', 'aluno', ?, ?, ?, 1, ?)`,
    nome || email, email, turma.id, turma.curso_id ?? null, matricula, new Date().toISOString(),
  );
  return { id: ultimoId, criado: true };
}

async function importarAtividade(bd, chave, turma, item) {
  const origemId = texto(item.origem_id, 'o origem_id', { obrigatorio: false, max: 120 }) || null;
  const aluno = await resolverAluno(bd, turma, item.aluno || {});
  const d = await validarAtividade(bd, item);
  const agora = new Date().toISOString();

  const existente = origemId
    ? await bd.get('SELECT * FROM atividades WHERE origem = ? AND origem_id = ?', chave.nome, origemId)
    : null;

  const validado = item.validado ? 1 : 0;
  const observacao = texto(item.observacao, 'a observação', { obrigatorio: false, max: 2000 }) || null;

  if (existente) {
    await bd.run(
      `UPDATE atividades
          SET usuario_id = ?, titulo = ?, categoria = ?, categoria_id = ?, local = ?, responsavel = ?,
              data_atividade = ?, data_fim = ?, horas = ?, comprovante = ?, texto = ?,
              validado = ?, validado_por = ?, validado_em = ?, observacao = ?, atualizado_em = ?
        WHERE id = ?`,
      aluno.id, d.titulo, d.categoria, d.categoria_id, d.local, d.responsavel, d.data_atividade, d.data_fim,
      d.horas, d.comprovante, d.texto,
      validado, validado ? chave.professor_id : null, validado ? agora : null, observacao,
      agora, existente.id,
    );
    return { status: 'atualizada', atividade_id: existente.id, aluno_criado: aluno.criado };
  }

  const { ultimoId } = await bd.run(
    `INSERT INTO atividades
       (usuario_id, titulo, categoria, categoria_id, local, responsavel, data_atividade, data_fim, horas,
        comprovante, texto, origem, origem_id, validado, validado_por, validado_em, observacao,
        criado_em, atualizado_em)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    aluno.id, d.titulo, d.categoria, d.categoria_id, d.local, d.responsavel, d.data_atividade, d.data_fim, d.horas,
    d.comprovante, d.texto, chave.nome, origemId,
    validado, validado ? chave.professor_id : null, validado ? agora : null, observacao,
    agora, agora,
  );
  return { status: 'criada', atividade_id: ultimoId, aluno_criado: aluno.criado };
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
      let papelFinal = papel;
      let turmaId = null;
      let cursoId = null;
      let convite = null;
      let podeConvidar = 0;

      if (papel === 'aluno') {
        const codigo = normalizarCodigo(ctx.corpo.codigo_turma);
        if (!codigo) throw erro(400, 'Informe o código da turma que o professor passou.');
        // O curso vem junto da turma: é ele que define a carga obrigatória e os
        // limites por categoria do aluno.
        const turma = await turmaPorCodigo(bd, codigo);
        turmaId = turma.id;
        cursoId = turma.curso_id ?? null;
      } else {
        // A primeira conta de equipe da faculdade entra sem convite e já como
        // administradora — não haveria quem a convidasse. Daí em diante, só com
        // convite de uso único, e quem entra assim começa como professor.
        const { total } = await bd.get(
          `SELECT COUNT(*) AS total FROM usuarios WHERE papel IN ('professor', 'coordenador', 'admin')`,
        );
        if (total === 0) {
          podeConvidar = 1;
          papelFinal = 'admin';
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

      const existente = await bd.get('SELECT * FROM usuarios WHERE email = ?', email);
      if (existente) {
        // Aluno que a integração criou antes: a pessoa assume a conta agora,
        // e as horas já importadas continuam com ela.
        if (papel === 'aluno' && existente.pre_cadastrado) {
          await bd.run(
            `UPDATE usuarios
                SET nome = ?, senha_hash = ?, turma_id = ?, curso_id = ?,
                    matricula = COALESCE(?, matricula), pre_cadastrado = 0
              WHERE id = ?`,
            nome, await gerarHash(senha, iteracoesSenha), turmaId, cursoId, matricula, existente.id,
          );
          const sessao = await criarSessao(bd, existente.id);
          return {
            corpo: { usuario: { id: existente.id, nome, email, papel }, conta_assumida: true },
            cabecalhos: { 'Set-Cookie': cookieDeSessao(sessao.token, sessao.expira, ctx.seguro) },
          };
        }
        throw erro(409, 'Esse e-mail já está cadastrado. Use "Entrar" ou outro e-mail.');
      }

      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        `INSERT INTO usuarios(nome, email, senha_hash, papel, turma_id, curso_id, matricula,
                              instituicao, pode_convidar, criado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nome, email, await gerarHash(senha, iteracoesSenha), papelFinal,
        turmaId, cursoId, matricula, instituicao, podeConvidar, agora,
      );

      if (convite) {
        await bd.run('UPDATE convites SET usado_por = ?, usado_em = ? WHERE id = ?', ultimoId, agora, convite.id);
      }

      const { token, expira } = await criarSessao(bd, ultimoId);
      return {
        corpo: { usuario: { id: ultimoId, nome, email, papel: papelFinal } },
        cabecalhos: { 'Set-Cookie': cookieDeSessao(token, expira, ctx.seguro) },
      };
    }],

    ['POST', /^\/api\/login$/, async (ctx) => {
      const email = texto(ctx.corpo.email, 'seu e-mail', { max: 160 }).toLowerCase();
      const senha = typeof ctx.corpo.senha === 'string' ? ctx.corpo.senha : '';
      const usuario = await bd.get('SELECT * FROM usuarios WHERE email = ?', email);
      if (usuario && usuario.pre_cadastrado) {
        throw erro(401, 'Sua conta foi criada pela importação e ainda não tem senha. Use "Criar conta" com este mesmo e-mail.');
      }
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
      const professor = exigirEquipe(ctx.exigirLogin());
      return { corpo: { turmas: await turmasVisiveis(bd, professor) } };
    }],

    ['POST', /^\/api\/turmas$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const nome = texto(ctx.corpo.nome, 'o nome da turma', { max: 120 });
      const periodo = texto(ctx.corpo.periodo, 'o período', { obrigatorio: false, max: 60 }) || null;
      const curso = await cursoValido(bd, ctx.corpo.curso_id, professor);
      const meta = Number(ctx.corpo.meta_horas ?? curso?.horas_obrigatorias ?? META_PADRAO);
      if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
      const { ultimoId } = await bd.run(
        `INSERT INTO turmas(nome, periodo, codigo, professor_id, curso_id, meta_horas, criado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
        nome, periodo, await gerarCodigoTurma(bd), professor.id, curso ? curso.id : null,
        meta, new Date().toISOString(),
      );
      return { status: 201, corpo: { turma: await bd.get('SELECT * FROM turmas WHERE id = ?', ultimoId) } };
    }],

    ['PUT', /^\/api\/turmas\/(\d+)$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      const atual = await turmaVisivel(bd, id, professor);
      if (!atual) throw erro(404, 'Turma não encontrada.');
      const nome = texto(ctx.corpo.nome, 'o nome da turma', { max: 120 });
      const periodo = texto(ctx.corpo.periodo, 'o período', { obrigatorio: false, max: 60 }) || null;
      const curso = ctx.corpo.curso_id === undefined
        ? { id: atual.curso_id }
        : await cursoValido(bd, ctx.corpo.curso_id, professor);
      const meta = Number(ctx.corpo.meta_horas ?? atual.meta_horas);
      if (!Number.isFinite(meta) || meta <= 0) throw erro(400, 'Meta de horas inválida.');
      await bd.run(
        'UPDATE turmas SET nome = ?, periodo = ?, curso_id = ?, meta_horas = ? WHERE id = ?',
        nome, periodo, curso ? curso.id : null, meta, id,
      );
      return { corpo: { turma: await bd.get('SELECT * FROM turmas WHERE id = ?', id) } };
    }],

    ['DELETE', /^\/api\/turmas\/(\d+)$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await turmaVisivel(bd, id, professor))) throw erro(404, 'Turma não encontrada.');
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
      const corpo = { usuario, categorias: await listarCategorias(bd) };
      if (!usuario) {
        const { total } = await bd.get(
          `SELECT COUNT(*) AS total FROM usuarios WHERE papel IN ('professor', 'coordenador', 'admin')`,
        );
        corpo.convite_obrigatorio = total > 0;
      }
      if (usuario && usuario.papel === 'aluno') {
        corpo.curso = await bd.get(
          'SELECT c.id, c.nome, c.horas_obrigatorias FROM usuarios u JOIN cursos c ON c.id = u.curso_id WHERE u.id = ?',
          usuario.id,
        );
        corpo.resumo = await resumo(bd, usuario.id);
        corpo.professor = await bd.get(
          `SELECT p.nome, p.instituicao FROM usuarios u
             JOIN turmas t ON t.id = u.turma_id
             JOIN usuarios p ON p.id = t.professor_id
            WHERE u.id = ?`,
          usuario.id,
        );
      }
      if (usuario && PAPEIS_EQUIPE.includes(usuario.papel)) {
        corpo.turmas = await turmasVisiveis(bd, usuario);
        corpo.cursos = await listarCursos(bd);
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
      const nova = codigo ? await turmaPorCodigo(bd, codigo) : null;
      const matricula = texto(ctx.corpo.matricula, 'a matrícula', { obrigatorio: false, max: 40 }) || null;
      await bd.run(
        `UPDATE usuarios
            SET nome = ?, turma_id = ?, curso_id = COALESCE(?, curso_id), matricula = ?
          WHERE id = ?`,
        nome, nova ? nova.id : usuario.turma_id, nova ? nova.curso_id : null, matricula, usuario.id,
      );
      return { corpo: { ok: true, resumo: await resumo(bd, usuario.id) } };
    }],

    ['GET', /^\/api\/atividades$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      if (PAPEIS_EQUIPE.includes(usuario.papel)) {
        const turmaId = ctx.url.searchParams.get('turma_id');
        return {
          corpo: { atividades: await atividadesDaEquipe(bd, usuario, turmaId ? Number(turmaId) : null) },
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
      const d = await validarAtividade(bd, ctx.corpo);
      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        `INSERT INTO atividades
           (usuario_id, titulo, categoria, categoria_id, local, responsavel, data_atividade, data_fim,
            horas, comprovante, texto, arquivo_nome, criado_em, atualizado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        usuario.id, d.titulo, d.categoria, d.categoria_id, d.local, d.responsavel,
        d.data_atividade, d.data_fim, d.horas, d.comprovante, d.texto, d.arquivo_nome, agora, agora,
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

      const d = await validarAtividade(bd, ctx.corpo);
      // Editar o conteúdo derruba o selo do professor: ele revalida a versão nova.
      await bd.run(
        `UPDATE atividades
            SET titulo = ?, categoria = ?, categoria_id = ?, local = ?, responsavel = ?,
                data_atividade = ?, data_fim = ?, horas = ?, comprovante = ?, texto = ?, arquivo_nome = ?,
                validado = 0, validado_por = NULL, validado_em = NULL, atualizado_em = ?
          WHERE id = ?`,
        d.titulo, d.categoria, d.categoria_id, d.local, d.responsavel, d.data_atividade, d.data_fim,
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
        PAPEIS_EQUIPE.includes(usuario.papel) && (await atividadeVisivelAEquipe(bd, atual.id, usuario));
      if (!proprio && !daMinhaTurma) throw erro(403, 'Essa atividade é de outro aluno.');
      await bd.run('DELETE FROM atividades WHERE id = ?', atual.id);
      return { corpo: { ok: true, resumo: await resumo(bd, atual.usuario_id) } };
    }],

    ['POST', /^\/api\/atividades\/(\d+)\/validacao$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await atividadeVisivelAEquipe(bd, id, professor))) {
        throw erro(404, 'Atividade não encontrada no que você acompanha.');
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
      const equipe = exigirEquipe(ctx.exigirLogin());
      const turmaId = ctx.url.searchParams.get('turma_id');
      const { filtro, parametros } = escopoTurmas(equipe);
      const linhas = await bd.all(
        `SELECT u.id, u.nome, u.email, u.matricula, u.turma_id, u.semestre,
                t.nome AS turma_nome, t.meta_horas, c.nome AS curso_nome, c.horas_obrigatorias,
                COUNT(a.id) AS registros,
                COALESCE(SUM(a.horas), 0) AS declarado,
                COALESCE(SUM(CASE WHEN a.validado = 1 THEN a.horas ELSE 0 END), 0) AS validado,
                COALESCE(SUM(CASE WHEN a.validado = 0 THEN 1 ELSE 0 END), 0) AS pendentes
           FROM usuarios u
           JOIN turmas t ON t.id = u.turma_id
           LEFT JOIN cursos c ON c.id = COALESCE(u.curso_id, t.curso_id)
           LEFT JOIN atividades a ON a.usuario_id = u.id
          WHERE u.papel = 'aluno' ${filtro} ${turmaId ? 'AND t.id = ?' : ''}
          GROUP BY u.id
          ORDER BY u.nome COLLATE NOCASE`,
        ...parametros,
        ...(turmaId ? [Number(turmaId)] : []),
      );
      const alunos = linhas.map((l) => ({
        ...l,
        declarado: Math.round(l.declarado * 100) / 100,
        validado: Math.round(l.validado * 100) / 100,
        meta: Number(l.horas_obrigatorias ?? l.meta_horas ?? META_PADRAO),
      }));
      return { corpo: { alunos, turmas: await turmasVisiveis(bd, equipe) } };
    }],

    // ---------- estrutura acadêmica ----------

    ['GET', /^\/api\/cursos$/, async (ctx) => {
      exigirEquipe(ctx.exigirLogin());
      const cursos = await listarCursos(bd);
      for (const curso of cursos) {
        curso.alunos = (await bd.get(
          "SELECT COUNT(*) AS total FROM usuarios WHERE curso_id = ? AND papel = 'aluno'", curso.id,
        )).total;
        curso.coordenadores = await bd.all(
          `SELECT u.id, u.nome, u.email FROM coordenacoes co
             JOIN usuarios u ON u.id = co.usuario_id
            WHERE co.curso_id = ? ORDER BY u.nome COLLATE NOCASE`,
          curso.id,
        );
        curso.regras = await bd.all(
          `SELECT r.categoria_id, cat.nome AS categoria_nome, r.limite_horas, r.percentual_max
             FROM regras_categoria r JOIN categorias cat ON cat.id = r.categoria_id
            WHERE r.curso_id = ? ORDER BY cat.ordem, cat.nome COLLATE NOCASE`,
          curso.id,
        );
      }
      return { corpo: { cursos } };
    }],

    ['POST', /^\/api\/cursos$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const nome = texto(ctx.corpo.nome, 'o nome do curso', { max: 120 });
      const sigla = texto(ctx.corpo.sigla, 'a sigla', { obrigatorio: false, max: 20 }) || null;
      const horas = Number(ctx.corpo.horas_obrigatorias);
      if (!Number.isFinite(horas) || horas <= 0) throw erro(400, 'Carga obrigatória inválida.');
      const { ultimoId } = await bd.run(
        'INSERT INTO cursos(nome, sigla, horas_obrigatorias, criado_em) VALUES(?, ?, ?, ?)',
        nome, sigla, horas, new Date().toISOString(),
      );
      return { status: 201, corpo: { curso: await bd.get('SELECT * FROM cursos WHERE id = ?', ultimoId) } };
    }],

    ['PUT', /^\/api\/cursos\/(\d+)$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await bd.get('SELECT 1 AS existe FROM cursos WHERE id = ?', id))) throw erro(404, 'Curso não encontrado.');
      const nome = texto(ctx.corpo.nome, 'o nome do curso', { max: 120 });
      const sigla = texto(ctx.corpo.sigla, 'a sigla', { obrigatorio: false, max: 20 }) || null;
      const horas = Number(ctx.corpo.horas_obrigatorias);
      if (!Number.isFinite(horas) || horas <= 0) throw erro(400, 'Carga obrigatória inválida.');
      await bd.run(
        'UPDATE cursos SET nome = ?, sigla = ?, horas_obrigatorias = ?, ativo = ? WHERE id = ?',
        nome, sigla, horas, ctx.corpo.ativo === false ? 0 : 1, id,
      );
      return { corpo: { curso: await bd.get('SELECT * FROM cursos WHERE id = ?', id) } };
    }],

    // Regras chegam inteiras: o que não vier na lista deixa de valer.
    ['PUT', /^\/api\/cursos\/(\d+)\/regras$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const cursoId = Number(ctx.parametros[0]);
      if (!(await bd.get('SELECT 1 AS existe FROM cursos WHERE id = ?', cursoId))) throw erro(404, 'Curso não encontrado.');
      const regras = Array.isArray(ctx.corpo.regras) ? ctx.corpo.regras : [];

      await bd.run('DELETE FROM regras_categoria WHERE curso_id = ?', cursoId);
      for (const regra of regras) {
        const categoria = await bd.get('SELECT id FROM categorias WHERE id = ?', Number(regra.categoria_id));
        if (!categoria) throw erro(400, 'Categoria inválida nas regras.');
        const limite = regra.limite_horas === null || regra.limite_horas === undefined || regra.limite_horas === ''
          ? null : Number(regra.limite_horas);
        const percentual = regra.percentual_max === null || regra.percentual_max === undefined || regra.percentual_max === ''
          ? null : Number(regra.percentual_max);
        if (limite !== null && (!Number.isFinite(limite) || limite < 0)) throw erro(400, 'Limite de horas inválido.');
        if (percentual !== null && (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100)) {
          throw erro(400, 'Percentual precisa ficar entre 1 e 100.');
        }
        await bd.run(
          'INSERT INTO regras_categoria(curso_id, categoria_id, limite_horas, percentual_max) VALUES(?, ?, ?, ?)',
          cursoId, categoria.id, limite, percentual,
        );
      }
      return { corpo: { ok: true, regras: regras.length } };
    }],

    ['POST', /^\/api\/cursos\/(\d+)\/coordenadores$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const cursoId = Number(ctx.parametros[0]);
      const usuario = await bd.get('SELECT * FROM usuarios WHERE id = ?', Number(ctx.corpo.usuario_id));
      if (!usuario) throw erro(404, 'Usuário não encontrado.');
      if (usuario.papel === 'aluno') throw erro(400, 'Um aluno não pode coordenar um curso.');
      await bd.run(
        'INSERT OR IGNORE INTO coordenacoes(usuario_id, curso_id, criada_em) VALUES(?, ?, ?)',
        usuario.id, cursoId, new Date().toISOString(),
      );
      if (usuario.papel === 'professor') {
        await bd.run("UPDATE usuarios SET papel = 'coordenador' WHERE id = ?", usuario.id);
      }
      return { corpo: { ok: true } };
    }],

    ['DELETE', /^\/api\/cursos\/(\d+)\/coordenadores\/(\d+)$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      await bd.run(
        'DELETE FROM coordenacoes WHERE curso_id = ? AND usuario_id = ?',
        Number(ctx.parametros[0]), Number(ctx.parametros[1]),
      );
      return { corpo: { ok: true } };
    }],

    ['GET', /^\/api\/categorias$/, async (ctx) => {
      ctx.exigirLogin();
      return { corpo: { categorias: await listarCategorias(bd) } };
    }],

    ['POST', /^\/api\/categorias$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const nome = texto(ctx.corpo.nome, 'o nome da categoria', { max: 80 });
      if (await bd.get('SELECT 1 AS existe FROM categorias WHERE nome = ?', nome)) {
        throw erro(409, 'Já existe uma categoria com esse nome.');
      }
      const { ultimoId } = await bd.run(
        'INSERT INTO categorias(nome, descricao, ordem, criada_em) VALUES(?, ?, ?, ?)',
        nome,
        texto(ctx.corpo.descricao, 'a descrição', { obrigatorio: false, max: 300 }) || null,
        Number(ctx.corpo.ordem) || 50,
        new Date().toISOString(),
      );
      return { status: 201, corpo: { categoria: await bd.get('SELECT * FROM categorias WHERE id = ?', ultimoId) } };
    }],

    ['PUT', /^\/api\/categorias\/(\d+)$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await bd.get('SELECT 1 AS existe FROM categorias WHERE id = ?', id))) throw erro(404, 'Categoria não encontrada.');
      await bd.run(
        'UPDATE categorias SET nome = ?, descricao = ?, ordem = ?, ativa = ? WHERE id = ?',
        texto(ctx.corpo.nome, 'o nome da categoria', { max: 80 }),
        texto(ctx.corpo.descricao, 'a descrição', { obrigatorio: false, max: 300 }) || null,
        Number(ctx.corpo.ordem) || 50,
        ctx.corpo.ativa === false ? 0 : 1,
        id,
      );
      return { corpo: { categoria: await bd.get('SELECT * FROM categorias WHERE id = ?', id) } };
    }],

    // Categoria com histórico não some: ela é desativada e some das listas novas.
    ['DELETE', /^\/api\/categorias\/(\d+)$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      const usada = await bd.get('SELECT COUNT(*) AS total FROM atividades WHERE categoria_id = ?', id);
      if (usada.total > 0) {
        await bd.run('UPDATE categorias SET ativa = 0 WHERE id = ?', id);
        return { corpo: { ok: true, desativada: true, atividades: usada.total } };
      }
      await bd.run('DELETE FROM categorias WHERE id = ?', id);
      return { corpo: { ok: true, desativada: false } };
    }],

    ['GET', /^\/api\/usuarios$/, async (ctx) => {
      exigirAdmin(ctx.exigirLogin());
      const usuarios = await bd.all(
        `SELECT u.id, u.nome, u.email, u.papel, u.matricula, u.semestre, u.pre_cadastrado,
                u.curso_id, c.nome AS curso_nome, t.nome AS turma_nome
           FROM usuarios u
           LEFT JOIN cursos c ON c.id = u.curso_id
           LEFT JOIN turmas t ON t.id = u.turma_id
          ORDER BY u.papel, u.nome COLLATE NOCASE`,
      );
      return { corpo: { usuarios } };
    }],

    ['PUT', /^\/api\/usuarios\/(\d+)$/, async (ctx) => {
      const admin = exigirAdmin(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      const alvo = await bd.get('SELECT * FROM usuarios WHERE id = ?', id);
      if (!alvo) throw erro(404, 'Usuário não encontrado.');

      const papel = ctx.corpo.papel ?? alvo.papel;
      if (!['aluno', ...PAPEIS_EQUIPE].includes(papel)) throw erro(400, 'Papel inválido.');
      if (alvo.id === admin.id && papel !== 'admin') {
        throw erro(409, 'Você não pode tirar o seu próprio acesso de administrador.');
      }
      const curso = ctx.corpo.curso_id === undefined
        ? { id: alvo.curso_id }
        : await cursoValido(bd, ctx.corpo.curso_id, admin);

      await bd.run(
        'UPDATE usuarios SET papel = ?, curso_id = ?, semestre = ?, matricula = ? WHERE id = ?',
        papel,
        curso ? curso.id : null,
        texto(ctx.corpo.semestre ?? alvo.semestre, 'o semestre', { obrigatorio: false, max: 20 }) || null,
        texto(ctx.corpo.matricula ?? alvo.matricula, 'a matrícula', { obrigatorio: false, max: 40 }) || null,
        id,
      );
      return { corpo: { ok: true } };
    }],

    ['GET', /^\/api\/chaves$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const chaves = await bd.all(
        `SELECT id, nome, prefixo, criada_em, ultimo_uso_em, chamadas, revogada_em
           FROM chaves_api WHERE professor_id = ? ORDER BY id DESC`,
        professor.id,
      );
      return { corpo: { chaves } };
    }],

    ['POST', /^\/api\/chaves$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const nome = texto(ctx.corpo.nome, 'o nome do sistema que vai enviar os dados', { max: 80 });
      const { token, prefixo } = await criarChave(bd, professor.id, nome);
      // O token só aparece aqui: depois disso o banco tem apenas o hash.
      return { status: 201, corpo: { token, prefixo, nome } };
    }],

    ['DELETE', /^\/api\/chaves\/(\d+)$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      const chave = await bd.get('SELECT * FROM chaves_api WHERE id = ? AND professor_id = ?', id, professor.id);
      if (!chave) throw erro(404, 'Chave não encontrada.');
      await bd.run('UPDATE chaves_api SET revogada_em = ? WHERE id = ?', new Date().toISOString(), id);
      return { corpo: { ok: true } };
    }],

    // Entrada de máquina: outro sistema envia as horas já apuradas.
    ['POST', /^\/api\/integracao\/atividades$/, async (ctx) => {
      const chave = await professorDaChave(bd, ctx.autorizacao);
      const codigo = normalizarCodigo(ctx.corpo.turma_codigo);
      if (!codigo) throw erro(400, 'Informe turma_codigo.');
      const turma = await bd.get(
        'SELECT * FROM turmas WHERE codigo = ? AND professor_id = ?',
        codigo, chave.professor_id,
      );
      if (!turma) throw erro(404, 'Turma não encontrada para esta chave.');

      const itens = Array.isArray(ctx.corpo.atividades) ? ctx.corpo.atividades : null;
      if (!itens || itens.length === 0) throw erro(400, 'Envie ao menos uma atividade em "atividades".');
      if (itens.length > LIMITE_LOTE) throw erro(413, `Máximo de ${LIMITE_LOTE} atividades por chamada.`);

      // Um item inválido não derruba o lote: cada linha volta com o seu resultado.
      const resultados = [];
      for (const [indice, item] of itens.entries()) {
        try {
          resultados.push({
            indice,
            origem_id: item?.origem_id ?? null,
            ...(await importarAtividade(bd, chave, turma, item ?? {})),
          });
        } catch (e) {
          if (!(e instanceof ErroHttp)) throw e;
          resultados.push({ indice, origem_id: item?.origem_id ?? null, status: 'erro', motivo: e.message });
        }
      }

      const conta = (status) => resultados.filter((r) => r.status === status).length;
      return {
        corpo: {
          turma: { id: turma.id, nome: turma.nome },
          recebidas: itens.length,
          criadas: conta('criada'),
          atualizadas: conta('atualizada'),
          erros: conta('erro'),
          alunos_criados: resultados.filter((r) => r.aluno_criado).length,
          resultados,
        },
      };
    }],

    ['GET', /^\/api\/exportar\.csv$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const turmaId = ctx.url.searchParams.get('turma_id');
      const linhas =
        PAPEIS_EQUIPE.includes(usuario.papel)
          ? await atividadesDaEquipe(bd, usuario, turmaId ? Number(turmaId) : null)
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
