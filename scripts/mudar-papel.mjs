// Troca o papel de uma conta — professor vira aluno, aluno vira professor.
//
// A tela Configurações → Pessoas já faz isso, mas ela pede um admin logado e
// não deixa ninguém tirar o próprio acesso de administrador. Quando é a conta
// do admin que precisa virar aluno, o caminho é este.
//
//   npm run papel -- fulano@ex.br aluno                 só mostra o que faria
//   npm run papel -- fulano@ex.br aluno --aplicar       muda de verdade
//   npm run papel -- fulano@ex.br aluno --turma ABC123  já entra nessa sala
//   npm run papel -- fulano@ex.br aluno --local         banco do seu computador
//
// Sem --local ele fala com o banco publicado na Cloudflare, pelo wrangler.

import { execFileSync } from 'node:child_process';

const BANCO = 'horas-complementares';
const PAPEIS = ['aluno', 'professor', 'coordenador', 'admin'];

// ---------------------------------------------------------------- o que muda

// Monta a lista de passos e as ressalvas, sem tocar em nada. Quem chama decide
// se executa: é isso que faz o ensaio e a aplicação contarem a mesma história.
export async function planoDeMudanca(bd, { email, papel, codigoTurma = null }) {
  if (!PAPEIS.includes(papel)) {
    throw new Error(`Papel inválido: "${papel}". Use ${PAPEIS.join(', ')}.`);
  }

  const conta = await bd.get('SELECT * FROM usuarios WHERE lower(email) = ?', email.toLowerCase());
  if (!conta) throw new Error(`Nenhuma conta com o e-mail ${email}.`);

  const turmas = await bd.all(
    'SELECT id, nome, codigo FROM turmas WHERE professor_id = ? ORDER BY nome', conta.id);
  const materias = await bd.all(
    `SELECT m.id, m.nome, t.nome AS turma FROM materias m
       JOIN turmas t ON t.id = m.turma_id
      WHERE m.professor_id = ? ORDER BY t.nome, m.nome`,
    conta.id);
  const coordenacoes = await bd.all(
    `SELECT c.nome FROM coordenacoes co JOIN cursos c ON c.id = co.curso_id
      WHERE co.usuario_id = ? ORDER BY c.nome`,
    conta.id);
  const chaves = await bd.all(
    'SELECT nome, prefixo FROM chaves_api WHERE professor_id = ? AND revogada_em IS NULL ORDER BY id',
    conta.id);
  const { admins, equipe } = await bd.get(
    `SELECT (SELECT COUNT(*) FROM usuarios WHERE papel = 'admin' AND id <> ?) AS admins,
            (SELECT COUNT(*) FROM usuarios
              WHERE papel IN ('professor', 'coordenador', 'admin') AND id <> ?) AS equipe`,
    conta.id, conta.id);

  let turmaNova = null;
  if (codigoTurma) {
    turmaNova = await bd.get(
      'SELECT id, nome, curso_id FROM turmas WHERE codigo = ?', codigoTurma.trim().toUpperCase());
    if (!turmaNova) throw new Error(`Nenhuma sala com o código ${codigoTurma}.`);
  }

  const viraAluno = papel === 'aluno' && conta.papel !== 'aluno';
  const passos = [];
  const avisos = [];
  const impedimentos = [];

  if (conta.papel === papel && !turmaNova) {
    avisos.push(`A conta já é ${papel}: não há o que mudar.`);
  }

  passos.push({
    conta: `papel: ${conta.papel} → ${papel}`,
    sql: ['UPDATE usuarios SET papel = ? WHERE id = ?', papel, conta.id],
  });

  if (viraAluno) {
    // Os poderes de equipe não somem sozinhos com a troca de papel. A chave de
    // integração é a que mais dói: quem confere a chave olha só a linha dela,
    // então ela continuaria mandando horas para as salas antigas.
    if (chaves.length) {
      passos.push({
        conta: `revoga ${chaves.length} chave(s) de integração: ${chaves.map((c) => c.prefixo).join(', ')}`,
        sql: ['UPDATE chaves_api SET revogada_em = ? WHERE professor_id = ? AND revogada_em IS NULL',
          new Date().toISOString(), conta.id],
      });
    }
    if (coordenacoes.length) {
      passos.push({
        conta: `larga a coordenação de: ${coordenacoes.map((c) => c.nome).join(', ')}`,
        sql: ['DELETE FROM coordenacoes WHERE usuario_id = ?', conta.id],
      });
    }
    if (turmas.length) {
      passos.push({
        conta: `${turmas.length} sala(s) ficam sem dono: ${turmas.map((t) => t.nome).join(', ')}`,
        sql: ['UPDATE turmas SET professor_id = NULL WHERE professor_id = ?', conta.id],
      });
      avisos.push('Sala sem dono só volta a ter um pelas mãos do admin — anote os códigos acima.');
    }
    if (materias.length) {
      passos.push({
        conta: `${materias.length} matéria(s) ficam sem professor: ${materias.map((m) => `${m.turma}/${m.nome}`).join(', ')}`,
        sql: ['UPDATE materias SET professor_id = NULL WHERE professor_id = ?', conta.id],
      });
    }
    passos.push({
      conta: 'apaga a instituição e o direito de convidar (são de quem dá aula)',
      sql: ['UPDATE usuarios SET instituicao = NULL, pode_convidar = 0 WHERE id = ?', conta.id],
    });
  }

  if (turmaNova) {
    passos.push({
      conta: `entra na sala ${turmaNova.nome}${turmaNova.curso_id ? ' (e herda o curso dela)' : ''}`,
      sql: ['UPDATE usuarios SET turma_id = ?, curso_id = COALESCE(?, curso_id) WHERE id = ?',
        turmaNova.id, turmaNova.curso_id ?? null, conta.id],
    });
  } else if (papel === 'aluno' && !conta.turma_id) {
    avisos.push('Sem sala, o aluno entra e não vê mural nem horas. Use --turma CODIGO, '
      + 'ou entre pelo código depois, na tela de Perfil.');
  }

  // Perder o último admin tranca cursos, categorias e a própria tela de
  // Pessoas: ninguém mais consegue abrir.
  if (conta.papel === 'admin' && papel !== 'admin' && admins === 0) {
    impedimentos.push(equipe === 0
      ? 'Esta é a última conta da equipe. Depois dela a instalação fica sem admin — mas a '
        + 'próxima conta de professor criada entra sem convite e já como admin, que é a regra '
        + 'da primeira conta. Se é isso mesmo, rode de novo com --forcar.'
      : `Sobra equipe (${equipe} conta[s]), mas nenhum admin — e só o admin abre Pessoas, `
        + 'cursos e categorias. Promova alguém a admin antes, ou rode de novo com --forcar.');
  }

  passos.push({
    conta: 'anota a troca na auditoria',
    sql: [`INSERT INTO auditoria(entidade, entidade_id, acao, descricao, usuario_nome, papel, criado_em)
           VALUES('usuario', ?, 'papel', ?, 'scripts/mudar-papel', ?, ?)`,
      conta.id, `${conta.email}: ${conta.papel} → ${papel}`, conta.papel, new Date().toISOString()],
  });

  return { conta, papel, turmaNova, passos, avisos, impedimentos };
}

export async function aplicarPlano(bd, plano) {
  for (const passo of plano.passos) await bd.run(...passo.sql);
  return bd.get('SELECT id, nome, email, papel, turma_id, curso_id FROM usuarios WHERE id = ?', plano.conta.id);
}

// ---------------------------------------------------------------- banco publicado

// O wrangler não aceita parâmetros separados do comando, então os valores
// entram no próprio SQL. Todo o SQL daqui é escrito neste arquivo — nenhum "?"
// mora dentro de texto —, e os valores vão escapados.
const literal = (valor) => {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'number') return String(valor);
  return `'${String(valor).replace(/'/g, "''")}'`;
};

const montar = (sql, parametros) => {
  let i = 0;
  const pronto = sql.replace(/\?/g, () => literal(parametros[i++]));
  if (i !== parametros.length) throw new Error('SQL e parâmetros não batem.');
  return pronto;
};

function bancoRemoto() {
  const executar = (sql) => {
    let bruto;
    try {
      // stdin herdado: sem terminal à vista o wrangler se declara não
      // interativo e passa a exigir CLOUDFLARE_API_TOKEN mesmo já logado.
      bruto = execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', BANCO, '--remote', '--json', '--command', sql],
        { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] },
      );
    } catch (e) {
      console.error('\nO wrangler não conseguiu falar com o banco. Ele respondeu:\n');
      console.error([e.stdout, e.stderr].filter(Boolean).join('\n').trim() || `(sem saída) código ${e.status ?? '?'}`);
      console.error('\nSe falar em login, rode: npx wrangler login\n');
      process.exit(1);
    }
    const primeiro = (v) => (Array.isArray(v) ? primeiro(v[0]) : v);
    return primeiro(JSON.parse(bruto.slice(bruto.indexOf('[')))) ?? {};
  };

  return {
    async all(sql, ...parametros) {
      return executar(montar(sql, parametros)).results ?? [];
    },
    async get(sql, ...parametros) {
      return (await this.all(sql, ...parametros))[0] ?? null;
    },
    async run(sql, ...parametros) {
      const { meta } = executar(montar(sql, parametros));
      return { mudancas: meta?.changes ?? 0 };
    },
  };
}

// ---------------------------------------------------------------- linha de comando

async function principal(argv) {
  const marcado = (nome) => argv.includes(`--${nome}`);
  const valor = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  const soltos = argv.filter((a, i) =>
    !a.startsWith('--') && !['turma'].includes(argv[i - 1]?.replace(/^--/, '')));

  const [email, papel] = soltos;
  if (!email || !papel) {
    console.log('\nTroca o papel de uma conta.\n');
    console.log('  npm run papel -- <e-mail> <aluno|professor|coordenador|admin> [opções]\n');
    console.log('  --aplicar        muda de verdade (sem isso é só um ensaio)');
    console.log('  --turma CODIGO   já coloca o aluno nessa sala');
    console.log('  --local          mexe no banco do seu computador, não no publicado');
    console.log('  --forcar         segue mesmo deixando a instalação sem admin\n');
    process.exit(1);
  }

  let bd;
  if (marcado('local')) {
    const { bancoLocal } = await import('../src/sqlite.js');
    bd = bancoLocal();
  } else {
    bd = bancoRemoto();
  }

  const onde = marcado('local') ? 'banco local' : `banco publicado (${BANCO})`;
  let plano;
  try {
    plano = await planoDeMudanca(bd, { email, papel, codigoTurma: valor('turma') });
  } catch (e) {
    console.error(`\n  ✗ ${e.message}\n`);
    process.exit(1);
  }

  const { conta } = plano;
  console.log(`\n${conta.nome} <${conta.email}> — ${onde}\n`);
  for (const passo of plano.passos) console.log(`  · ${passo.conta}`);
  for (const aviso of plano.avisos) console.log(`\n  ⚠ ${aviso}`);

  if (plano.impedimentos.length && !marcado('forcar')) {
    for (const impedimento of plano.impedimentos) console.error(`\n  ✗ ${impedimento}`);
    console.error('');
    process.exit(1);
  }

  if (!marcado('aplicar')) {
    console.log('\nIsto foi um ensaio: nada mudou. Repita com --aplicar.\n');
    return;
  }

  const depois = await aplicarPlano(bd, plano);
  console.log(`\n  ✓ ${depois.email} agora é ${depois.papel}.`);
  console.log('    Quem estiver com a tela aberta precisa sair e entrar de novo.\n');
}

// Só roda como programa; importado (pelos testes) fica quieto.
if (process.argv[1] && process.argv[1].endsWith('mudar-papel.mjs')) {
  await principal(process.argv.slice(2));
}
