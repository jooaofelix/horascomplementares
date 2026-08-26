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

export const STATUS = ['pendente', 'em_analise', 'aprovado', 'reprovado', 'correcao'];
const EXIGEM_MOTIVO = ['reprovado', 'correcao'];
const NOME_STATUS = {
  pendente: 'aguardando análise',
  em_analise: 'em análise',
  aprovado: 'aprovada',
  reprovado: 'reprovada',
  correcao: 'devolvida para correção',
};

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

// Todas as matérias da sala, com quem dá cada uma. A sala é compartilhada: o
// professor vê as matérias dos colegas, mas só edita as que são dele.
async function materiasDaTurma(bd, turmaId, usuario) {
  const linhas = await bd.all(
    `SELECT m.id, m.nome, m.turma_id, m.conta_horas, m.professor_id, p.nome AS professor_nome
       FROM materias m LEFT JOIN usuarios p ON p.id = m.professor_id
      WHERE m.turma_id = ? ORDER BY m.nome COLLATE NOCASE`,
    turmaId,
  );
  return linhas.map((m) => ({
    ...m,
    minha: m.professor_id === usuario.id,
    posso_editar: usuario.papel !== 'professor' || m.professor_id === usuario.id,
  }));
}

// Mexer na sala em si (nome, meta, excluir) é de quem a criou — o colega que
// entrou pelo código cuida só da matéria dele.
const donoDaTurma = (turma, usuario) =>
  usuario.papel !== 'professor' || turma.professor_id === usuario.id;

async function turmasVisiveis(bd, usuario) {
  const { filtro, parametros } = escopoTurmas(usuario);
  const turmas = await bd.all(
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
  for (const turma of turmas) {
    turma.materias = await materiasDaTurma(bd, turma.id, usuario);
    turma.posso_editar = donoDaTurma(turma, usuario);
  }
  return turmas;
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
  // Quem entra na sala já vê o que vai encontrar lá dentro.
  turma.materias = await bd.all(
    `SELECT m.id, m.nome, m.conta_horas, p.nome AS professor_nome
       FROM materias m LEFT JOIN usuarios p ON p.id = m.professor_id
      WHERE m.turma_id = ? ORDER BY m.nome COLLATE NOCASE`,
    turma.id,
  );
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
  a.status, a.horas_aprovadas, a.motivo, a.analisado_em,
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
            COALESCE(SUM(CASE WHEN a.status = 'aprovado' THEN COALESCE(a.horas_aprovadas, a.horas) ELSE 0 END), 0) AS validado,
            COALESCE(SUM(CASE WHEN a.status <> 'reprovado' THEN a.horas ELSE 0 END), 0) AS declarado
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
            COALESCE(SUM(CASE WHEN status = 'aprovado' THEN COALESCE(horas_aprovadas, horas) ELSE 0 END), 0) AS validado,
            COALESCE(SUM(CASE WHEN status IN ('pendente', 'em_analise', 'correcao') THEN horas ELSE 0 END), 0) AS aguardando,
            COALESCE(SUM(CASE WHEN status = 'reprovado' THEN horas ELSE 0 END), 0) AS reprovado,
            COALESCE(SUM(CASE WHEN status IN ('pendente', 'em_analise', 'correcao') THEN 1 ELSE 0 END), 0) AS pendentes
       FROM atividades WHERE usuario_id = ?`,
    usuarioId,
  );
  return {
    registros: linha.registros,
    declarado: Math.round(linha.declarado * 100) / 100,
    validado: Math.round(linha.validado * 100) / 100,
    aguardando: Math.round(linha.aguardando * 100) / 100,
    reprovado: Math.round(linha.reprovado * 100) / 100,
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

// Recorte de salas por papel: é o que separa o que cada um enxerga. O professor
// alcança a sala que criou e toda sala onde tem matéria — inclusive as que outro
// professor abriu.
function escopoTurmas(usuario) {
  if (usuario.papel === 'admin') return { filtro: '', parametros: [] };
  if (usuario.papel === 'coordenador') {
    return {
      filtro: 'AND t.curso_id IN (SELECT curso_id FROM coordenacoes WHERE usuario_id = ?)',
      parametros: [usuario.id],
    };
  }
  return {
    filtro: `AND (t.professor_id = ?
                  OR EXISTS (SELECT 1 FROM materias m WHERE m.turma_id = t.id AND m.professor_id = ?))`,
    parametros: [usuario.id, usuario.id],
  };
}

// Recorte de matérias: dentro da mesma sala, cada professor mexe só nas suas.
function escopoMaterias(usuario) {
  if (usuario.papel === 'admin') return { filtro: '', parametros: [] };
  if (usuario.papel === 'coordenador') {
    return {
      filtro: `AND m.turma_id IN (SELECT id FROM turmas
                                   WHERE curso_id IN (SELECT curso_id FROM coordenacoes WHERE usuario_id = ?))`,
      parametros: [usuario.id],
    };
  }
  return { filtro: 'AND m.professor_id = ?', parametros: [usuario.id] };
}

function paraCsv(linhas) {
  const cabecalho = [
    'aluno', 'matricula', 'turma', 'data_inicio', 'data_fim', 'atividade', 'categoria',
    'local', 'responsavel', 'horas_declaradas', 'horas_aprovadas', 'status', 'validado_por', 'observacao',
    'comprovante', 'caracteres_analise', 'arquivo',
  ];
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const corpo = linhas.map((a) =>
    [
      a.aluno_nome, a.aluno_matricula || '', a.turma_nome || '',
      a.data_atividade, a.data_fim || '', a.titulo, a.categoria,
      a.local || '', a.responsavel || '',
      String(a.horas).replace('.', ','),
      String(a.horas_aprovadas ?? '').replace('.', ','),
      a.status ?? (a.validado ? 'aprovado' : 'pendente'),
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

// Só quem alcança a turma do aluno chega às anotações dele.
async function alunoAoAlcance(bd, alunoId, usuario) {
  const { filtro, parametros } = escopoTurmas(usuario);
  const aluno = await bd.get(
    `SELECT u.id, u.nome FROM usuarios u
       JOIN turmas t ON t.id = u.turma_id
      WHERE u.id = ? AND u.papel = 'aluno' ${filtro}`,
    alunoId, ...parametros,
  );
  if (!aluno) throw erro(404, 'Aluno não encontrado.');
  return aluno;
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
              status = ?, horas_aprovadas = ?,
              validado = ?, validado_por = ?, validado_em = ?, observacao = ?, atualizado_em = ?
        WHERE id = ?`,
      aluno.id, d.titulo, d.categoria, d.categoria_id, d.local, d.responsavel, d.data_atividade, d.data_fim,
      d.horas, d.comprovante, d.texto,
      validado ? 'aprovado' : 'pendente', validado ? d.horas : null,
      validado, validado ? chave.professor_id : null, validado ? agora : null, observacao,
      agora, existente.id,
    );
    return { status: 'atualizada', atividade_id: existente.id, aluno_criado: aluno.criado };
  }

  const { ultimoId } = await bd.run(
    `INSERT INTO atividades
       (usuario_id, titulo, categoria, categoria_id, local, responsavel, data_atividade, data_fim, horas,
        comprovante, texto, origem, origem_id, status, horas_aprovadas,
        validado, validado_por, validado_em, observacao, criado_em, atualizado_em)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    aluno.id, d.titulo, d.categoria, d.categoria_id, d.local, d.responsavel, d.data_atividade, d.data_fim, d.horas,
    d.comprovante, d.texto, chave.nome, origemId,
    validado ? 'aprovado' : 'pendente', validado ? d.horas : null,
    validado, validado ? chave.professor_id : null, validado ? agora : null, observacao,
    agora, agora,
  );
  return { status: 'criada', atividade_id: ultimoId, aluno_criado: aluno.criado };
}

// ---------- auditoria ----------

// Cada passo vira uma linha nova. Nada aqui é editado ou apagado depois: o
// nome e o papel de quem agiu ficam congelados no momento do registro.
async function registrar(bd, ctx, entidade, entidadeId, acao, descricao, dados = null) {
  await bd.run(
    `INSERT INTO auditoria(entidade, entidade_id, acao, descricao, dados,
                           usuario_id, usuario_nome, papel, ip, criado_em)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entidade, entidadeId, acao, descricao,
    dados ? JSON.stringify(dados) : null,
    ctx.usuario?.id ?? null, ctx.usuario?.nome ?? 'sistema', ctx.usuario?.papel ?? null,
    ctx.ip ?? null, new Date().toISOString(),
  );
}

const historico = (bd, entidade, entidadeId) =>
  bd.all(
    `SELECT id, acao, descricao, dados, usuario_nome, papel, criado_em
       FROM auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id`,
    entidade, entidadeId,
  );

// ---------- arquivos ----------

// Tipo do arquivo -> extensão guardada. Slides e documentos entram aqui porque
// é com eles que a aula é publicada no dia a dia.
const TIPOS_ACEITOS = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};

// O navegador nem sempre sabe o tipo (celular, formatos do Office): quando ele
// manda vazio ou genérico, a extensão do nome resolve.
const TIPO_POR_EXTENSAO = Object.fromEntries(
  Object.entries(TIPOS_ACEITOS).map(([tipo, extensao]) => [extensao, tipo]),
);

function tipoDoArquivo(nome, tipoInformado) {
  const informado = String(tipoInformado || '').toLowerCase().split(';')[0].trim();
  if (TIPOS_ACEITOS[informado]) return informado;
  const extensao = String(nome || '').toLowerCase().split('.').pop();
  return TIPO_POR_EXTENSAO[extensao] ?? informado;
}

export const FORMATOS_ACEITOS = Object.values(TIPOS_ACEITOS);

function bytesDeBase64(base64) {
  const limpo = String(base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!limpo) throw erro(400, 'Arquivo vazio.');
  const binario = atob(limpo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function guardarArquivo(bd, armazenamento, usuario, dados) {
  if (!armazenamento) throw erro(503, 'Armazenamento de arquivos não configurado.');
  const nome = texto(dados.nome, 'o nome do arquivo', { max: 200 });
  const tipo = tipoDoArquivo(nome, dados.tipo);
  if (!TIPOS_ACEITOS[tipo]) {
    throw erro(400,
      `Formato não aceito (${dados.tipo || 'desconhecido'}). ` +
      'Envie PDF, slide (PPTX/PPT/ODP), documento (DOCX/DOC/ODT), planilha, imagem ou texto.');
  }

  const bytes = bytesDeBase64(dados.conteudo);
  if (bytes.length > armazenamento.limite) {
    const mb = (armazenamento.limite / (1024 * 1024)).toFixed(1).replace('.', ',');
    throw erro(413, `Arquivo grande demais. O limite aqui é de ${mb} MB.`);
  }

  // O hash identifica o conteúdo exato que foi enviado: se o arquivo mudar, ele
  // muda junto. É também a base da verificação de autenticidade mais adiante.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');

  const chave = `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint8Array(8)),
    (b) => b.toString(16).padStart(2, '0')).join('')}.${TIPOS_ACEITOS[tipo]}`;
  await armazenamento.guardar(chave, bytes, tipo);

  const { ultimoId } = await bd.run(
    `INSERT INTO arquivos(nome, tipo, tamanho, hash_sha256, chave, destino, enviado_por, criado_em)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    nome, tipo, bytes.length, hash, chave, armazenamento.nome, usuario.id, new Date().toISOString(),
  );
  return bd.get('SELECT id, nome, tipo, tamanho, hash_sha256, chave FROM arquivos WHERE id = ?', ultimoId);
}

// Quem pode baixar: a equipe que alcança a matéria do material, o aluno da sala
// onde ele foi publicado, e o autor da própria entrega.
async function arquivoPermitido(bd, arquivoId, usuario) {
  const arquivo = await bd.get('SELECT * FROM arquivos WHERE id = ?', arquivoId);
  if (!arquivo) return null;
  if (arquivo.enviado_por === usuario.id) return arquivo;

  const entrega = await bd.get('SELECT aluno_id, tarefa_id FROM entregas WHERE arquivo_id = ?', arquivoId);
  if (entrega) {
    if (usuario.papel === 'aluno') return entrega.aluno_id === usuario.id ? arquivo : null;
    return (await alcanca(bd, 'tarefas_materias', 'tarefa_id', entrega.tarefa_id, usuario)) ? arquivo : null;
  }

  const material = await bd.get('SELECT id, aula_id, materia_id FROM materiais WHERE arquivo_id = ?', arquivoId);
  if (!material) return null;

  if (usuario.papel === 'aluno') {
    const naSala = await bd.get(
      `SELECT 1 AS existe FROM materias m
        WHERE m.turma_id = ?
          AND (m.id = ? OR m.id IN (SELECT materia_id FROM aulas_materias WHERE aula_id = ?))
        LIMIT 1`,
      usuario.turma_id ?? 0, material.materia_id ?? 0, material.aula_id ?? 0,
    );
    return naSala ? arquivo : null;
  }
  if (material.aula_id && (await alcanca(bd, 'aulas_materias', 'aula_id', material.aula_id, usuario))) {
    return arquivo;
  }
  const { filtro, parametros } = escopoMaterias(usuario);
  const daMateria = material.materia_id
    ? await bd.get(`SELECT 1 AS existe FROM materias m WHERE m.id = ? ${filtro}`, material.materia_id, ...parametros)
    : null;
  return daMateria ? arquivo : null;
}

// ---------- aulas e tarefas em várias matérias ----------

// A matéria precisa estar ao alcance de quem pede: o professor só publica nas
// dele, mesmo dividindo a sala com outros.
async function materiaDoPedido(bd, id, usuario) {
  const { filtro, parametros } = escopoMaterias(usuario);
  const materia = await bd.get(
    `SELECT m.*, t.nome AS turma_nome FROM materias m JOIN turmas t ON t.id = m.turma_id
      WHERE m.id = ? ${filtro}`,
    Number(id), ...parametros,
  );
  if (!materia) throw erro(404, 'Matéria não encontrada.');
  return materia;
}

// Recebe matérias (ou turmas, no formato antigo — aí vale a matéria de quem
// está publicando naquela sala) e devolve as que ele realmente alcança.
async function materiasDoPedido(bd, corpo, usuario) {
  const materias = [];
  const brutas = Array.isArray(corpo.materia_ids) && corpo.materia_ids.length
    ? corpo.materia_ids
    : [corpo.materia_id].filter((v) => v !== undefined && v !== null && v !== '');

  if (brutas.length) {
    for (const id of [...new Set(brutas.map(Number))]) materias.push(await materiaDoPedido(bd, id, usuario));
    return materias;
  }

  const porTurma = Array.isArray(corpo.turma_ids) && corpo.turma_ids.length
    ? corpo.turma_ids
    : [corpo.turma_id].filter((v) => v !== undefined && v !== null && v !== '');
  if (!porTurma.length) throw erro(400, 'Escolha ao menos uma matéria.');

  const { filtro, parametros } = escopoMaterias(usuario);
  for (const turmaId of [...new Set(porTurma.map(Number))]) {
    const turma = await turmaDoPedido(bd, turmaId, usuario);
    const minha = await bd.get(
      `SELECT m.* FROM materias m WHERE m.turma_id = ? ${filtro} ORDER BY m.id LIMIT 1`,
      turma.id, ...parametros,
    );
    if (!minha) throw erro(404, `Você não tem matéria em ${turma.nome}. Crie a matéria primeiro.`);
    materias.push(minha);
  }
  return materias;
}

async function vincular(bd, tabela, coluna, id, materias) {
  await bd.run(`DELETE FROM ${tabela} WHERE ${coluna} = ?`, id);
  for (const materia of materias) {
    await bd.run(`INSERT OR IGNORE INTO ${tabela}(${coluna}, materia_id) VALUES(?, ?)`, id, materia.id);
  }
}

const materiasDoVinculo = (bd, tabela, coluna, id) =>
  bd.all(
    `SELECT m.id, m.nome, m.turma_id, t.nome AS turma_nome
       FROM ${tabela} v JOIN materias m ON m.id = v.materia_id JOIN turmas t ON t.id = m.turma_id
      WHERE v.${coluna} = ? ORDER BY t.nome COLLATE NOCASE, m.nome COLLATE NOCASE`,
    id,
  );

const materiasDaAula = (bd, aulaId) => materiasDoVinculo(bd, 'aulas_materias', 'aula_id', aulaId);
const materiasDaTarefa = (bd, tarefaId) => materiasDoVinculo(bd, 'tarefas_materias', 'tarefa_id', tarefaId);

// Quem publicou alcança pelo menos uma das matérias da aula/tarefa.
async function alcanca(bd, tabela, coluna, id, usuario) {
  const { filtro, parametros } = escopoMaterias(usuario);
  return bd.get(
    `SELECT 1 AS existe FROM ${tabela} v JOIN materias m ON m.id = v.materia_id
      WHERE v.${coluna} = ? ${filtro} LIMIT 1`,
    id, ...parametros,
  );
}

// ---------- mural ----------

async function muralDaMateria(bd, materiaId, usuario) {
  const aulas = await bd.all(
    `SELECT a.id, a.titulo, a.descricao, a.data_aula, a.ordem, a.publicada
       FROM aulas a JOIN aulas_materias am ON am.aula_id = a.id
      WHERE am.materia_id = ? ORDER BY COALESCE(a.data_aula, '9999'), a.ordem, a.id`,
    materiaId,
  );
  // Material de aula compartilhada aparece nas duas matérias; material solto é
  // da matéria em que foi criado.
  const materiais = await bd.all(
    `SELECT m.id, m.aula_id, m.tipo, m.titulo, m.descricao, m.url, m.arquivo_id,
            a.nome AS arquivo_nome, a.tipo AS arquivo_tipo, a.tamanho AS arquivo_tamanho
       FROM materiais m LEFT JOIN arquivos a ON a.id = m.arquivo_id
      WHERE (m.aula_id IN (SELECT aula_id FROM aulas_materias WHERE materia_id = ?))
         OR (m.aula_id IS NULL AND m.materia_id = ?)
      ORDER BY m.id`,
    materiaId, materiaId,
  );
  const tarefas = await bd.all(
    `SELECT t.id, t.aula_id, t.titulo, t.enunciado, t.prazo, t.horas_sugeridas, t.publicada,
            c.nome AS categoria_nome,
            (SELECT COUNT(*) FROM entregas e WHERE e.tarefa_id = t.id) AS entregas,
            (SELECT COUNT(*) FROM entregas e WHERE e.tarefa_id = t.id AND e.status = 'enviada') AS a_avaliar,
            (SELECT COUNT(*) FROM tarefas_materias x WHERE x.tarefa_id = t.id) AS materias
       FROM tarefas t
       JOIN tarefas_materias tm ON tm.tarefa_id = t.id
       LEFT JOIN categorias c ON c.id = t.categoria_id
      WHERE tm.materia_id = ? ORDER BY COALESCE(t.prazo, '9999'), t.id`,
    materiaId,
  );

  const ehAluno = usuario.papel === 'aluno';
  const minhasEntregas = ehAluno
    ? await bd.all(
        `SELECT e.*, a.nome AS arquivo_nome FROM entregas e
           LEFT JOIN arquivos a ON a.id = e.arquivo_id
          WHERE e.aluno_id = ?
            AND e.tarefa_id IN (SELECT tarefa_id FROM tarefas_materias WHERE materia_id = ?)`,
        usuario.id, materiaId,
      )
    : [];

  const visiveis = (lista) => (ehAluno ? lista.filter((x) => x.publicada !== 0) : lista);
  const comEntrega = (t) => ({
    ...t,
    minha_entrega: minhasEntregas.find((e) => e.tarefa_id === t.id) ?? null,
  });

  const materiasPorAula = {};
  for (const aula of aulas) materiasPorAula[aula.id] = await materiasDaAula(bd, aula.id);

  return {
    aulas: visiveis(aulas).map((aula) => ({
      ...aula,
      materias: materiasPorAula[aula.id] ?? [],
      materiais: materiais.filter((m) => m.aula_id === aula.id),
      tarefas: visiveis(tarefas).filter((t) => t.aula_id === aula.id).map(comEntrega),
    })),
    avulsos: {
      materiais: materiais.filter((m) => !m.aula_id),
      tarefas: visiveis(tarefas).filter((t) => !t.aula_id).map(comEntrega),
    },
  };
}

// O mural da sala: uma seção por matéria. O aluno vê todas as matérias da sala
// dele; o professor, as que são dele. As listas soltas no fim são a soma de
// todas as matérias, para quem só quer ver a sala inteira de uma vez.
async function muralDaTurma(bd, turmaId, usuario) {
  const { filtro, parametros } =
    usuario.papel === 'aluno' ? { filtro: '', parametros: [] } : escopoMaterias(usuario);
  const materias = await bd.all(
    `SELECT m.id, m.nome, m.conta_horas, m.professor_id, p.nome AS professor_nome
       FROM materias m LEFT JOIN usuarios p ON p.id = m.professor_id
      WHERE m.turma_id = ? ${filtro} ORDER BY m.nome COLLATE NOCASE`,
    turmaId, ...parametros,
  );

  const cheias = [];
  for (const materia of materias) {
    cheias.push({ ...materia, ...(await muralDaMateria(bd, materia.id, usuario)) });
  }
  const juntar = (pegar) => cheias.flatMap(pegar);
  return {
    materias: cheias,
    aulas: juntar((m) => m.aulas.map((a) => ({ ...a, materia_id: m.id, materia_nome: m.nome }))),
    avulsos: {
      materiais: juntar((m) => m.avulsos.materiais),
      tarefas: juntar((m) => m.avulsos.tarefas.map((t) => ({ ...t, materia_id: m.id, materia_nome: m.nome }))),
    },
  };
}

// A turma que o pedido diz respeito precisa estar ao alcance de quem pede.
async function turmaDoPedido(bd, id, usuario) {
  if (usuario.papel === 'aluno') {
    if (Number(id) !== usuario.turma_id) throw erro(403, 'Essa turma não é a sua.');
    return bd.get('SELECT * FROM turmas WHERE id = ?', Number(id));
  }
  const turma = await turmaVisivel(bd, Number(id), usuario);
  if (!turma) throw erro(404, 'Turma não encontrada.');
  return turma;
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
      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        `INSERT INTO turmas(nome, periodo, codigo, professor_id, curso_id, meta_horas, criado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
        nome, periodo, await gerarCodigoTurma(bd), professor.id, curso ? curso.id : null, meta, agora,
      );
      // Sala sem matéria não serve para nada: a primeira nasce junto, no nome de
      // quem criou. As outras entram depois, de cada professor.
      await bd.run(
        'INSERT INTO materias(turma_id, nome, professor_id, conta_horas, criada_em) VALUES(?, ?, ?, ?, ?)',
        ultimoId,
        texto(ctx.corpo.materia, 'o nome da matéria', { obrigatorio: false, max: 120 }) || nome,
        professor.id, ctx.corpo.conta_horas ? 1 : 0, agora,
      );
      return {
        status: 201,
        corpo: {
          turma: await bd.get('SELECT * FROM turmas WHERE id = ?', ultimoId),
          materias: await materiasDaTurma(bd, ultimoId, professor),
        },
      };
    }],

    ['PUT', /^\/api\/turmas\/(\d+)$/, async (ctx) => {
      const professor = exigirEquipe(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      const atual = await turmaVisivel(bd, id, professor);
      if (!atual) throw erro(404, 'Turma não encontrada.');
      if (!donoDaTurma(atual, professor)) {
        throw erro(403, 'Essa turma é de outro professor. Você cuida da sua matéria nela.');
      }
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
      const turma = await turmaVisivel(bd, id, professor);
      if (!turma) throw erro(404, 'Turma não encontrada.');
      if (!donoDaTurma(turma, professor)) {
        throw erro(403, 'Essa turma é de outro professor. Você cuida da sua matéria nela.');
      }
      const comAlunos = await bd.get('SELECT COUNT(*) AS total FROM usuarios WHERE turma_id = ?', id);
      if (comAlunos.total > 0) {
        throw erro(409, `Essa turma tem ${comAlunos.total} aluno(s). Mova-os antes de excluir.`);
      }
      await bd.run('DELETE FROM turmas WHERE id = ?', id);
      return { corpo: { ok: true } };
    }],

    // ---------- matérias dentro da sala ----------

    ['GET', /^\/api\/materias$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const { filtro, parametros } = escopoMaterias(equipe);
      const materias = await bd.all(
        `SELECT m.id, m.nome, m.turma_id, m.conta_horas, m.professor_id,
                t.nome AS turma_nome, t.codigo AS turma_codigo, t.periodo,
                (SELECT COUNT(*) FROM usuarios u WHERE u.turma_id = m.turma_id AND u.papel = 'aluno') AS alunos
           FROM materias m JOIN turmas t ON t.id = m.turma_id
          WHERE 1 = 1 ${filtro}
          ORDER BY t.nome COLLATE NOCASE, m.nome COLLATE NOCASE`,
        ...parametros,
      );
      return { corpo: { materias } };
    }],

    // O professor abre a matéria dele numa sala que já existe — a dele ou a de
    // um colega, e nesse caso o que ele tem em mãos é o código da sala.
    ['POST', /^\/api\/materias$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const codigo = normalizarCodigo(ctx.corpo.codigo_turma);
      const turma = codigo
        ? await turmaPorCodigo(bd, codigo)
        : await turmaDoPedido(bd, ctx.corpo.turma_id, equipe);
      if (equipe.papel === 'coordenador' && codigo) {
        const cheia = await bd.get('SELECT curso_id FROM turmas WHERE id = ?', turma.id);
        await cursoValido(bd, cheia?.curso_id, equipe);
      }
      const nome = texto(ctx.corpo.nome, 'o nome da matéria', { max: 120 });
      const { ultimoId } = await bd.run(
        'INSERT INTO materias(turma_id, nome, professor_id, conta_horas, criada_em) VALUES(?, ?, ?, ?, ?)',
        turma.id, nome,
        ctx.corpo.professor_id && equipe.papel !== 'professor'
          ? Number(ctx.corpo.professor_id)
          : equipe.id,
        ctx.corpo.conta_horas ? 1 : 0, new Date().toISOString(),
      );
      await registrar(bd, ctx, 'materia', ultimoId, 'criada', `${nome} em ${turma.nome}`);
      return {
        status: 201,
        corpo: {
          materia: await bd.get('SELECT * FROM materias WHERE id = ?', ultimoId),
          turma: { id: turma.id, nome: turma.nome },
        },
      };
    }],

    ['PUT', /^\/api\/materias\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const materia = await materiaDoPedido(bd, ctx.parametros[0], equipe);
      const nome = texto(ctx.corpo.nome ?? materia.nome, 'o nome da matéria', { max: 120 });
      await bd.run(
        'UPDATE materias SET nome = ?, conta_horas = ? WHERE id = ?',
        nome,
        ctx.corpo.conta_horas === undefined ? materia.conta_horas : (ctx.corpo.conta_horas ? 1 : 0),
        materia.id,
      );
      return { corpo: { materia: await bd.get('SELECT * FROM materias WHERE id = ?', materia.id) } };
    }],

    ['DELETE', /^\/api\/materias\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const materia = await materiaDoPedido(bd, ctx.parametros[0], equipe);
      const { total } = await bd.get(
        `SELECT (SELECT COUNT(*) FROM aulas_materias WHERE materia_id = ?)
              + (SELECT COUNT(*) FROM tarefas_materias WHERE materia_id = ?) AS total`,
        materia.id, materia.id,
      );
      if (total > 0) throw erro(409, `Essa matéria tem ${total} aula(s) e tarefa(s). Apague-as antes.`);
      await bd.run('DELETE FROM materias WHERE id = ?', materia.id);
      return { corpo: { ok: true } };
    }],

    ['GET', /^\/api\/materias\/(\d+)\/mural$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      let materia;
      if (usuario.papel === 'aluno') {
        materia = await bd.get(
          `SELECT m.*, t.nome AS turma_nome FROM materias m JOIN turmas t ON t.id = m.turma_id
            WHERE m.id = ? AND m.turma_id = ?`,
          Number(ctx.parametros[0]), usuario.turma_id ?? 0,
        );
        if (!materia) throw erro(403, 'Essa matéria não é da sua sala.');
      } else {
        materia = await materiaDoPedido(bd, ctx.parametros[0], exigirEquipe(usuario));
      }
      return {
        corpo: {
          materia: { id: materia.id, nome: materia.nome, conta_horas: materia.conta_horas },
          turma: { id: materia.turma_id, nome: materia.turma_nome },
          ...(await muralDaMateria(bd, materia.id, usuario)),
        },
      };
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
      const corpo = {
        usuario,
        categorias: await listarCategorias(bd),
        limite_arquivo: opcoes.arquivos?.limite ?? 0,
        formatos: FORMATOS_ACEITOS,
      };
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
        // Basta uma matéria de estágio ou extensão na sala para o aluno ter a
        // parte de horas complementares.
        corpo.conta_horas = !!(await bd.get(
          'SELECT 1 AS existe FROM materias WHERE turma_id = ? AND conta_horas = 1 LIMIT 1',
          usuario.turma_id ?? 0,
        ));
        corpo.resumo = await resumo(bd, usuario.id);
        corpo.turma = await bd.get(
          'SELECT id, nome, periodo FROM turmas WHERE id = ?', usuario.turma_id ?? 0,
        );
        corpo.materias = await bd.all(
          `SELECT m.id, m.nome, m.conta_horas, p.nome AS professor_nome, p.instituicao
             FROM materias m LEFT JOIN usuarios p ON p.id = m.professor_id
            WHERE m.turma_id = ? ORDER BY m.nome COLLATE NOCASE`,
          usuario.turma_id ?? 0,
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
      await registrar(bd, ctx, 'atividade', ultimoId, 'criada',
        `Atividade lançada pelo aluno: ${d.titulo} (${d.horas} h declaradas).`,
        { horas: d.horas, categoria: d.categoria });

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
                status = 'pendente', horas_aprovadas = NULL, analisado_por = NULL, analisado_em = NULL,
                validado = 0, validado_por = NULL, validado_em = NULL, atualizado_em = ?
          WHERE id = ?`,
        d.titulo, d.categoria, d.categoria_id, d.local, d.responsavel, d.data_atividade, d.data_fim,
        d.horas, d.comprovante, d.texto, d.arquivo_nome, new Date().toISOString(), atual.id,
      );
      await registrar(bd, ctx, 'atividade', atual.id, 'editada',
        `Aluno editou a atividade; ela volta para a fila de análise.`,
        { antes: { horas: atual.horas, titulo: atual.titulo }, depois: { horas: d.horas, titulo: d.titulo } });

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

    // Análise da solicitação: aprova, reprova, devolve para correção ou marca
    // que está em análise — sempre deixando rastro.
    ['POST', /^\/api\/atividades\/(\d+)\/analise$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const id = Number(ctx.parametros[0]);
      if (!(await atividadeVisivelAEquipe(bd, id, equipe))) {
        throw erro(404, 'Atividade não encontrada no que você acompanha.');
      }
      const atual = await buscarAtividade(bd, id);

      const status = texto(ctx.corpo.status, 'o status', { max: 20 });
      if (!STATUS.includes(status)) throw erro(400, 'Status inválido.');

      const motivo = texto(ctx.corpo.motivo ?? ctx.corpo.observacao, 'o motivo', { obrigatorio: false, max: 2000 }) || null;
      if (EXIGEM_MOTIVO.includes(status) && !motivo) {
        throw erro(400, status === 'reprovado'
          ? 'Diga ao aluno por que a atividade foi reprovada.'
          : 'Diga ao aluno o que precisa ser corrigido.');
      }

      let horasAprovadas = null;
      if (status === 'aprovado') {
        horasAprovadas = Number(ctx.corpo.horas_aprovadas ?? atual.horas);
        if (!Number.isFinite(horasAprovadas) || horasAprovadas <= 0) throw erro(400, 'Horas aprovadas inválidas.');
        if (horasAprovadas > atual.horas) {
          throw erro(400, `O aluno declarou ${atual.horas} h; não dá para aprovar mais do que isso.`);
        }
      }

      const agora = new Date().toISOString();
      await bd.run(
        `UPDATE atividades
            SET status = ?, horas_aprovadas = ?, motivo = ?, observacao = ?,
                analisado_por = ?, analisado_em = ?,
                validado = ?, validado_por = ?, validado_em = ?, atualizado_em = ?
          WHERE id = ?`,
        status, horasAprovadas, motivo, motivo,
        equipe.id, agora,
        status === 'aprovado' ? 1 : 0,
        status === 'aprovado' ? equipe.id : null,
        status === 'aprovado' ? agora : null,
        agora, id,
      );

      const cortou = status === 'aprovado' && horasAprovadas !== atual.horas;
      await registrar(bd, ctx, 'atividade', id, status,
        `Solicitação ${NOME_STATUS[status]}` +
        (status === 'aprovado' ? ` com ${horasAprovadas} h` : '') +
        (cortou ? ` (o aluno havia declarado ${atual.horas} h)` : '') +
        (motivo ? `. Motivo: ${motivo}` : '.'),
        { de: atual.status, para: status, horas_declaradas: atual.horas, horas_aprovadas: horasAprovadas });

      return { corpo: { atividade: await buscarAtividade(bd, id) } };
    }],

    ['GET', /^\/api\/atividades\/(\d+)\/historico$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const id = Number(ctx.parametros[0]);
      const atividade = await buscarAtividade(bd, id);
      if (!atividade) throw erro(404, 'Atividade não encontrada.');
      const proprio = atividade.usuario_id === usuario.id;
      if (!proprio && !(await atividadeVisivelAEquipe(bd, id, usuario))) {
        throw erro(404, 'Atividade não encontrada.');
      }
      return { corpo: { historico: await historico(bd, 'atividade', id) } };
    }],

    ['GET', /^\/api\/turma$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const turmaId = ctx.url.searchParams.get('turma_id');
      const { filtro, parametros } = escopoTurmas(equipe);
      const linhas = await bd.all(
        `SELECT u.id, u.nome, u.email, u.matricula, u.turma_id, u.semestre,
                t.nome AS turma_nome, t.meta_horas,
                (SELECT COUNT(*) FROM materias m WHERE m.turma_id = t.id AND m.conta_horas = 1) AS materias_com_horas,
                c.nome AS curso_nome, c.horas_obrigatorias,
                COUNT(a.id) AS registros,
                COALESCE(SUM(a.horas), 0) AS declarado,
                COALESCE(SUM(CASE WHEN a.status = 'aprovado' THEN COALESCE(a.horas_aprovadas, a.horas) ELSE 0 END), 0) AS validado,
                COALESCE(SUM(CASE WHEN a.status IN ('pendente', 'em_analise', 'correcao') THEN 1 ELSE 0 END), 0) AS pendentes
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
        conta_horas: l.materias_com_horas > 0,
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

    // ---------- aulas, materiais, tarefas e entregas ----------

    ['POST', /^\/api\/arquivos$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const arquivo = await guardarArquivo(bd, opcoes.arquivos, usuario, ctx.corpo);
      return { status: 201, corpo: { arquivo } };
    }],

    ['GET', /^\/api\/arquivos\/(\d+)$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const arquivo = await arquivoPermitido(bd, Number(ctx.parametros[0]), usuario);
      if (!arquivo) throw erro(404, 'Arquivo não encontrado.');
      const bytes = await opcoes.arquivos?.ler(arquivo.chave);
      if (!bytes) throw erro(404, 'Conteúdo do arquivo não encontrado.');
      return {
        binario: bytes,
        cabecalhos: {
          'Content-Type': arquivo.tipo,
          'Content-Disposition': `inline; filename="${arquivo.nome.replace(/"/g, '')}"`,
          'Cache-Control': 'private, max-age=600',
        },
      };
    }],

    ['GET', /^\/api\/turmas\/(\d+)\/mural$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      const turma = await turmaDoPedido(bd, ctx.parametros[0], usuario);
      return {
        corpo: {
          turma: { id: turma.id, nome: turma.nome, periodo: turma.periodo },
          ...(await muralDaTurma(bd, turma.id, usuario)),
        },
      };
    }],

    ['POST', /^\/api\/aulas$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const materias = await materiasDoPedido(bd, ctx.corpo, equipe);
      const materia = materias[0];
      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        `INSERT INTO aulas(turma_id, titulo, descricao, data_aula, ordem, publicada, criada_por, criada_em, atualizada_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        materia.turma_id,
        texto(ctx.corpo.titulo, 'o título da aula', { max: 160 }),
        texto(ctx.corpo.descricao, 'a descrição', { obrigatorio: false, max: 4000 }) || null,
        data(ctx.corpo.data_aula, 'a data da aula', { obrigatorio: false }),
        Number(ctx.corpo.ordem) || 0,
        ctx.corpo.publicada === false ? 0 : 1,
        equipe.id, agora, agora,
      );

      await vincular(bd, 'aulas_materias', 'aula_id', ultimoId, materias);

      // Anexar na mesma ação evita o segundo passo de "agora adicione o material".
      if (ctx.corpo.arquivo) {
        const arquivo = await guardarArquivo(bd, opcoes.arquivos, equipe, ctx.corpo.arquivo);
        await bd.run(
          `INSERT INTO materiais(turma_id, materia_id, aula_id, tipo, titulo, arquivo_id, criado_por, criado_em)
           VALUES(?, ?, ?, 'arquivo', ?, ?, ?, ?)`,
          materia.turma_id, materia.id, ultimoId,
          texto(ctx.corpo.arquivo.titulo, 'o título do material', { obrigatorio: false, max: 160 }) || arquivo.nome,
          arquivo.id, equipe.id, agora,
        );
      }

      return {
        status: 201,
        corpo: {
          aula: await bd.get('SELECT * FROM aulas WHERE id = ?', ultimoId),
          materias: await materiasDaAula(bd, ultimoId),
        },
      };
    }],

    ['PUT', /^\/api\/aulas\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const aula = await bd.get('SELECT * FROM aulas WHERE id = ?', Number(ctx.parametros[0]));
      if (!aula) throw erro(404, 'Aula não encontrada.');
      if (!(await alcanca(bd, 'aulas_materias', 'aula_id', aula.id, equipe))) {
        throw erro(404, 'Aula não encontrada.');
      }
      if (ctx.corpo.materia_ids || ctx.corpo.materia_id || ctx.corpo.turma_ids || ctx.corpo.turma_id) {
        await vincular(bd, 'aulas_materias', 'aula_id', aula.id, await materiasDoPedido(bd, ctx.corpo, equipe));
      }
      await bd.run(
        `UPDATE aulas SET titulo = ?, descricao = ?, data_aula = ?, ordem = ?, publicada = ?, atualizada_em = ?
          WHERE id = ?`,
        texto(ctx.corpo.titulo, 'o título da aula', { max: 160 }),
        texto(ctx.corpo.descricao, 'a descrição', { obrigatorio: false, max: 4000 }) || null,
        data(ctx.corpo.data_aula, 'a data da aula', { obrigatorio: false }),
        Number(ctx.corpo.ordem) || 0,
        ctx.corpo.publicada === false ? 0 : 1,
        new Date().toISOString(), aula.id,
      );
      return {
        corpo: {
          aula: await bd.get('SELECT * FROM aulas WHERE id = ?', aula.id),
          materias: await materiasDaAula(bd, aula.id),
        },
      };
    }],

    ['DELETE', /^\/api\/aulas\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const aula = await bd.get('SELECT * FROM aulas WHERE id = ?', Number(ctx.parametros[0]));
      if (!aula || !(await alcanca(bd, 'aulas_materias', 'aula_id', aula.id, equipe))) {
        throw erro(404, 'Aula não encontrada.');
      }
      await bd.run('DELETE FROM aulas WHERE id = ?', aula.id);
      return { corpo: { ok: true } };
    }],

    ['POST', /^\/api\/materiais$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const [materia] = await materiasDoPedido(bd, ctx.corpo, equipe);
      const tipo = ['arquivo', 'link', 'texto'].includes(ctx.corpo.tipo) ? ctx.corpo.tipo : 'arquivo';

      let arquivoId = null;
      if (tipo === 'arquivo') {
        if (!ctx.corpo.arquivo) throw erro(400, 'Envie o arquivo do material.');
        arquivoId = (await guardarArquivo(bd, opcoes.arquivos, equipe, ctx.corpo.arquivo)).id;
      }
      const url = tipo === 'link' ? texto(ctx.corpo.url, 'o endereço do link', { max: 500 }) : null;

      const { ultimoId } = await bd.run(
        `INSERT INTO materiais(turma_id, materia_id, aula_id, tipo, titulo, descricao, url, arquivo_id,
                               criado_por, criado_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        materia.turma_id, materia.id,
        ctx.corpo.aula_id ? Number(ctx.corpo.aula_id) : null,
        tipo,
        texto(ctx.corpo.titulo, 'o título do material', { max: 160 }),
        texto(ctx.corpo.descricao, 'a descrição', { obrigatorio: false, max: 2000 }) || null,
        url, arquivoId, equipe.id, new Date().toISOString(),
      );
      return { status: 201, corpo: { material: await bd.get('SELECT * FROM materiais WHERE id = ?', ultimoId) } };
    }],

    ['DELETE', /^\/api\/materiais\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const material = await bd.get('SELECT * FROM materiais WHERE id = ?', Number(ctx.parametros[0]));
      if (!material) throw erro(404, 'Material não encontrado.');
      // Material antigo, de antes das matérias, ainda responde pela turma dele.
      if (material.materia_id) await materiaDoPedido(bd, material.materia_id, equipe);
      else await turmaDoPedido(bd, material.turma_id, equipe);
      await bd.run('DELETE FROM materiais WHERE id = ?', material.id);
      return { corpo: { ok: true } };
    }],

    ['POST', /^\/api\/tarefas$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      // A tarefa herda as turmas da aula quando nasce dentro dela.
      const daAula = ctx.corpo.aula_id
        ? await materiasDaAula(bd, Number(ctx.corpo.aula_id))
        : [];
      const materias = daAula.length && !ctx.corpo.materia_ids && !ctx.corpo.turma_ids
        ? daAula
        : await materiasDoPedido(bd, ctx.corpo, equipe);
      const materia = materias[0];
      const agora = new Date().toISOString();
      const horas = ctx.corpo.horas_sugeridas === '' || ctx.corpo.horas_sugeridas === undefined || ctx.corpo.horas_sugeridas === null
        ? null : Number(ctx.corpo.horas_sugeridas);
      if (horas !== null && (!Number.isFinite(horas) || horas <= 0)) throw erro(400, 'Horas sugeridas inválidas.');

      const { ultimoId } = await bd.run(
        `INSERT INTO tarefas(turma_id, aula_id, titulo, enunciado, prazo, horas_sugeridas, categoria_id,
                             publicada, criada_por, criada_em, atualizada_em)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        materia.turma_id,
        ctx.corpo.aula_id ? Number(ctx.corpo.aula_id) : null,
        texto(ctx.corpo.titulo, 'o título da tarefa', { max: 160 }),
        texto(ctx.corpo.enunciado, 'o enunciado', { obrigatorio: false, max: 8000 }) || null,
        data(ctx.corpo.prazo, 'o prazo', { obrigatorio: false }),
        horas,
        ctx.corpo.categoria_id ? Number(ctx.corpo.categoria_id) : null,
        ctx.corpo.publicada === false ? 0 : 1,
        equipe.id, agora, agora,
      );
      await vincular(bd, 'tarefas_materias', 'tarefa_id', ultimoId, materias);
      return {
        status: 201,
        corpo: {
          tarefa: await bd.get('SELECT * FROM tarefas WHERE id = ?', ultimoId),
          materias: await materiasDaTarefa(bd, ultimoId),
        },
      };
    }],

    ['DELETE', /^\/api\/tarefas\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const tarefa = await bd.get('SELECT * FROM tarefas WHERE id = ?', Number(ctx.parametros[0]));
      if (!tarefa || !(await alcanca(bd, 'tarefas_materias', 'tarefa_id', tarefa.id, equipe))) {
        throw erro(404, 'Tarefa não encontrada.');
      }
      await bd.run('DELETE FROM tarefas WHERE id = ?', tarefa.id);
      return { corpo: { ok: true } };
    }],

    // O aluno envia (ou refaz) a própria entrega.
    ['PUT', /^\/api\/tarefas\/(\d+)\/entrega$/, async (ctx) => {
      const usuario = ctx.exigirLogin();
      if (usuario.papel !== 'aluno') throw erro(403, 'Só aluno entrega tarefa.');
      const tarefa = await bd.get(
        `SELECT t.* FROM tarefas t
           JOIN tarefas_materias tm ON tm.tarefa_id = t.id
           JOIN materias m ON m.id = tm.materia_id
          WHERE t.id = ? AND m.turma_id = ?`,
        Number(ctx.parametros[0]), usuario.turma_id,
      );
      if (!tarefa || !tarefa.publicada) throw erro(404, 'Tarefa não encontrada.');

      const atual = await bd.get(
        'SELECT * FROM entregas WHERE tarefa_id = ? AND aluno_id = ?', tarefa.id, usuario.id,
      );
      if (atual && atual.status === 'aceita') {
        throw erro(409, 'Sua entrega já foi aceita. Fale com o professor se precisar mudar algo.');
      }

      const conteudo = typeof ctx.corpo.texto === 'string' ? ctx.corpo.texto : '';
      if (conteudo.length > LIMITE_TEXTO) throw erro(400, 'Texto grande demais.');
      const arquivoId = ctx.corpo.arquivo
        ? (await guardarArquivo(bd, opcoes.arquivos, usuario, ctx.corpo.arquivo)).id
        : (atual?.arquivo_id ?? null);
      if (!conteudo.trim() && !arquivoId) throw erro(400, 'Escreva a resposta ou anexe um arquivo.');

      const agora = new Date().toISOString();
      if (atual) {
        await bd.run(
          `UPDATE entregas SET texto = ?, arquivo_id = ?, status = 'enviada', atualizada_em = ? WHERE id = ?`,
          conteudo, arquivoId, agora, atual.id,
        );
      } else {
        await bd.run(
          `INSERT INTO entregas(tarefa_id, aluno_id, texto, arquivo_id, enviada_em, atualizada_em)
           VALUES(?, ?, ?, ?, ?, ?)`,
          tarefa.id, usuario.id, conteudo, arquivoId, agora, agora,
        );
      }
      return {
        corpo: {
          entrega: await bd.get(
            'SELECT * FROM entregas WHERE tarefa_id = ? AND aluno_id = ?', tarefa.id, usuario.id,
          ),
        },
      };
    }],

    ['GET', /^\/api\/tarefas\/(\d+)\/entregas$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const tarefa = await bd.get('SELECT * FROM tarefas WHERE id = ?', Number(ctx.parametros[0]));
      if (!tarefa || !(await alcanca(bd, 'tarefas_materias', 'tarefa_id', tarefa.id, equipe))) {
        throw erro(404, 'Tarefa não encontrada.');
      }
      const entregas = await bd.all(
        `SELECT e.*, u.nome AS aluno_nome, u.matricula, t.nome AS turma_nome,
                arq.nome AS arquivo_nome, arq.tipo AS arquivo_tipo
           FROM entregas e
           JOIN usuarios u ON u.id = e.aluno_id
           LEFT JOIN turmas t ON t.id = u.turma_id
           LEFT JOIN arquivos arq ON arq.id = e.arquivo_id
          WHERE e.tarefa_id = ? ORDER BY u.nome COLLATE NOCASE`,
        tarefa.id,
      );
      // Quem ainda não entregou, em todas as turmas que a tarefa alcança.
      const semEntregar = await bd.all(
        `SELECT u.id, u.nome, t.nome AS turma_nome FROM usuarios u
           JOIN turmas t ON t.id = u.turma_id
          WHERE u.papel = 'aluno'
            AND u.turma_id IN (SELECT m.turma_id FROM tarefas_materias tm
                                 JOIN materias m ON m.id = tm.materia_id
                                WHERE tm.tarefa_id = ?)
            AND u.id NOT IN (SELECT aluno_id FROM entregas WHERE tarefa_id = ?)
          ORDER BY u.nome COLLATE NOCASE`,
        tarefa.id, tarefa.id,
      );
      return {
        corpo: { tarefa, materias: await materiasDaTarefa(bd, tarefa.id), entregas, sem_entregar: semEntregar },
      };
    }],

    // Aceitar a entrega cria (ou atualiza) a hora complementar já validada.
    ['POST', /^\/api\/entregas\/(\d+)\/avaliacao$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const entrega = await bd.get(
        `SELECT e.*, t.turma_id, t.titulo AS tarefa_titulo, t.horas_sugeridas, t.categoria_id,
                cat.nome AS categoria_nome, arq.nome AS arquivo_nome
           FROM entregas e
           JOIN tarefas t ON t.id = e.tarefa_id
           LEFT JOIN categorias cat ON cat.id = t.categoria_id
           LEFT JOIN arquivos arq ON arq.id = e.arquivo_id
          WHERE e.id = ?`,
        Number(ctx.parametros[0]),
      );
      if (!entrega || !(await alcanca(bd, 'tarefas_materias', 'tarefa_id', entrega.tarefa_id, equipe))) {
        throw erro(404, 'Entrega não encontrada.');
      }

      const status = ctx.corpo.status === 'devolvida' ? 'devolvida' : 'aceita';
      const observacao = texto(ctx.corpo.observacao, 'a observação', { obrigatorio: false, max: 2000 }) || null;
      if (status === 'devolvida' && !observacao) {
        throw erro(400, 'Diga ao aluno o que precisa ser corrigido.');
      }

      const agora = new Date().toISOString();
      let atividadeId = entrega.atividade_id;
      let horas = null;

      if (status === 'aceita') {
        horas = Number(ctx.corpo.horas ?? entrega.horas_sugeridas ?? 0);
        if (!Number.isFinite(horas) || horas < 0) throw erro(400, 'Horas inválidas.');

        if (horas > 0) {
          const categoria = entrega.categoria_id
            ? await bd.get('SELECT id, nome FROM categorias WHERE id = ?', entrega.categoria_id)
            : await bd.get("SELECT id, nome FROM categorias WHERE nome = 'Outro'");
          const campos = [
            entrega.tarefa_titulo, categoria?.nome ?? 'Outro', categoria?.id ?? null,
            horas, entrega.texto || '', entrega.arquivo_nome ?? null, observacao, horas, equipe.id, agora,
          ];
          if (atividadeId) {
            await bd.run(
              `UPDATE atividades
                  SET titulo = ?, categoria = ?, categoria_id = ?, horas = ?, texto = ?, arquivo_nome = ?,
                      observacao = ?, status = 'aprovado', horas_aprovadas = ?,
                      validado = 1, validado_por = ?, validado_em = ?, atualizado_em = ?
                WHERE id = ?`,
              ...campos, agora, atividadeId,
            );
          } else {
            const criada = await bd.run(
              `INSERT INTO atividades
                 (usuario_id, titulo, categoria, categoria_id, data_atividade, horas, texto, arquivo_nome,
                  observacao, status, horas_aprovadas, validado, validado_por, validado_em, origem,
                  criado_em, atualizado_em)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'aprovado', ?, 1, ?, ?, 'Tarefa da turma', ?, ?)`,
              entrega.aluno_id, entrega.tarefa_titulo, categoria?.nome ?? 'Outro', categoria?.id ?? null,
              agora.slice(0, 10), horas, entrega.texto || '', entrega.arquivo_nome ?? null,
              observacao, horas, equipe.id, agora, agora, agora,
            );
            atividadeId = criada.ultimoId;
          }
        }
      }

      await bd.run(
        `UPDATE entregas SET status = ?, observacao = ?, horas = ?, atividade_id = ?,
                             avaliada_por = ?, avaliada_em = ?, atualizada_em = ?
          WHERE id = ?`,
        status, observacao, horas, atividadeId, equipe.id, agora, agora, entrega.id,
      );

      return {
        corpo: {
          entrega: await bd.get('SELECT * FROM entregas WHERE id = ?', entrega.id),
          horas_lancadas: status === 'aceita' ? horas : 0,
        },
      };
    }],

    // ---------- anotações sobre o aluno (o aluno não vê) ----------

    ['GET', /^\/api\/alunos\/(\d+)\/anotacoes$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const aluno = await alunoAoAlcance(bd, Number(ctx.parametros[0]), equipe);
      const anotacoes = await bd.all(
        `SELECT a.id, a.texto, a.criada_em, a.atualizada_em, u.nome AS autor_nome, a.autor_id
           FROM anotacoes a LEFT JOIN usuarios u ON u.id = a.autor_id
          WHERE a.aluno_id = ? ORDER BY a.id DESC`,
        aluno.id,
      );
      return { corpo: { aluno: { id: aluno.id, nome: aluno.nome }, anotacoes } };
    }],

    ['POST', /^\/api\/alunos\/(\d+)\/anotacoes$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const aluno = await alunoAoAlcance(bd, Number(ctx.parametros[0]), equipe);
      const agora = new Date().toISOString();
      const { ultimoId } = await bd.run(
        'INSERT INTO anotacoes(aluno_id, autor_id, texto, criada_em, atualizada_em) VALUES(?, ?, ?, ?, ?)',
        aluno.id, equipe.id,
        texto(ctx.corpo.texto, 'a anotação', { max: 4000 }),
        agora, agora,
      );
      return { status: 201, corpo: { anotacao: await bd.get('SELECT * FROM anotacoes WHERE id = ?', ultimoId) } };
    }],

    // Cada um edita e apaga o que escreveu.
    ['PUT', /^\/api\/anotacoes\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const anotacao = await bd.get('SELECT * FROM anotacoes WHERE id = ?', Number(ctx.parametros[0]));
      if (!anotacao || anotacao.autor_id !== equipe.id) throw erro(404, 'Anotação não encontrada.');
      await bd.run(
        'UPDATE anotacoes SET texto = ?, atualizada_em = ? WHERE id = ?',
        texto(ctx.corpo.texto, 'a anotação', { max: 4000 }), new Date().toISOString(), anotacao.id,
      );
      return { corpo: { anotacao: await bd.get('SELECT * FROM anotacoes WHERE id = ?', anotacao.id) } };
    }],

    ['DELETE', /^\/api\/anotacoes\/(\d+)$/, async (ctx) => {
      const equipe = exigirEquipe(ctx.exigirLogin());
      const anotacao = await bd.get('SELECT * FROM anotacoes WHERE id = ?', Number(ctx.parametros[0]));
      if (!anotacao || anotacao.autor_id !== equipe.id) throw erro(404, 'Anotação não encontrada.');
      await bd.run('DELETE FROM anotacoes WHERE id = ?', anotacao.id);
      return { corpo: { ok: true } };
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
