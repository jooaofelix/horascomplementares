// Monta uma faculdade de mentira, cheia, e abre o sistema já com ela dentro.
//
//   npm run demo
//
// Serve para ver o sistema funcionando sem ter que cadastrar nada à mão: duas
// professoras dividindo uma turma, aulas com material, tarefas entregues, horas
// esperando validação. O banco é um arquivo à parte (data/demo.db) e é refeito
// do zero a cada vez — nada aqui encosta no banco de verdade.

import fs from 'node:fs';
import path from 'node:path';
import { bancoLocal } from '../src/sqlite.js';
import { armazenamentoD1 } from '../src/arquivos.js';
import { criarServidor } from '../server.js';

const CAMINHO = path.join(process.cwd(), 'data', 'demo.db');
const SENHA = 'demo1234';
const PORTA = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------- utilidades

// Um PDF de uma página, montado aqui mesmo para a demonstração não depender de
// nenhum arquivo solto no repositório.
function pdfDeUmaPagina(titulo, linhas) {
  const texto = [
    'BT /F1 20 Tf 60 780 Td (' + escaparPdf(titulo) + ') Tj ET',
    ...linhas.map((l, i) => `BT /F1 12 Tf 60 ${740 - i * 22} Td (${escaparPdf(l)}) Tj ET`),
  ].join('\n');

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(texto)} >>\nstream\n${texto}\nendstream`,
  ];

  let corpo = '%PDF-1.4\n';
  const posicoes = [];
  objetos.forEach((obj, i) => {
    posicoes.push(corpo.length);
    corpo += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const inicioXref = corpo.length;
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
    + posicoes.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}

const escaparPdf = (t) =>
  String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[()\\]/g, '\\$&');

const anexo = (nome, titulo, linhas) => ({
  nome,
  titulo,
  tipo: 'application/pdf',
  conteudo: pdfDeUmaPagina(titulo, linhas).toString('base64'),
});

// Datas relativas a hoje, para a demonstração nunca parecer velha.
const dia = (quantos) => {
  const d = new Date();
  d.setDate(d.getDate() + quantos);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- onde montar

// Sem argumento, a demonstração roda aqui no seu computador. Com
//   npm run demo -- --em https://seu-site.workers.dev
// ela é montada no sistema que já está publicado — útil para mostrar a alguém
// pelo link, mas só numa instalação nova: os dados são de mentira e depois é
// preciso apagá-los à mão.
const argumentos = process.argv.slice(2);
const valorDe = (nome) => {
  const igual = argumentos.find((a) => a.startsWith(`${nome}=`));
  if (igual) return igual.slice(nome.length + 1);
  const solto = argumentos.indexOf(nome);
  return solto >= 0 ? argumentos[solto + 1] : null;
};
const alvo = (valorDe('--em') || process.env.ALVO || '').replace(/\/$/, '');
const forcar = argumentos.includes('--forcar');

let servidor = null;
let base = alvo;

if (alvo) {
  console.log(`Montando a demonstração em ${alvo} …`);
  let eu;
  try {
    eu = await (await fetch(`${alvo}/api/eu`)).json();
  } catch (e) {
    console.error(`\nNão consegui falar com ${alvo}: ${e.message}\n`
      + 'Confira o endereço (com https://) e se o site está no ar.\n');
    process.exit(1);
  }
  // Instalação que já tem gente dentro não recebe dados de mentira por acidente.
  if (eu.convite_obrigatorio && !forcar) {
    console.error(`\nEsse endereço já tem contas de professor cadastradas.\n`
      + 'A demonstração cria pessoas e turmas fictícias, e não sei apagar o que já está lá.\n'
      + 'Se ainda assim quiser, repita o comando com --forcar.\n');
    process.exit(1);
  }
} else {
  fs.mkdirSync(path.dirname(CAMINHO), { recursive: true });
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(CAMINHO + sufixo, { force: true });

  const bd = bancoLocal(CAMINHO);
  servidor = criarServidor(bd, { arquivos: armazenamentoD1(bd) });
  await new Promise((r) => servidor.listen(PORTA, r));
  base = `http://127.0.0.1:${PORTA}`;
}

// Cada pessoa da demonstração é um cliente com o próprio cookie de sessão.
function pessoa() {
  let cookie = '';
  return async (caminho, { metodo = 'GET', corpo } = {}) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    for (const bruto of r.headers.getSetCookie()) {
      const par = bruto.split(';')[0];
      if (par.startsWith('sessao=')) cookie = par;
    }
    const dados = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status}: ${dados?.erro || 'falhou'}`);
    return dados;
  };
}

async function entrarComoProfessor(nome, email, convite = null, instituicao = null) {
  const c = pessoa();
  await c('/api/cadastro', {
    metodo: 'POST',
    corpo: { papel: 'professor', nome, email, senha: SENHA, codigo_convite: convite, instituicao },
  });
  return c;
}

async function entrarComoAluno(nome, email, codigoTurma, matricula) {
  const c = pessoa();
  await c('/api/cadastro', {
    metodo: 'POST',
    corpo: { papel: 'aluno', nome, email, senha: SENHA, codigo_turma: codigoTurma, matricula },
  });
  return c;
}

// ---------------------------------------------------------------- a faculdade

if (!alvo) console.log('Montando a faculdade de demonstração…');

// A primeira conta entra sem convite e já como administradora.
const marina = await entrarComoProfessor(
  'Profa. Marina Alves', 'marina@exemplo.br', null, 'Faculdade Exemplo',
);

const { curso } = await marina('/api/cursos', {
  metodo: 'POST', corpo: { nome: 'Psicologia', sigla: 'PSI', horas_obrigatorias: 100 },
});

// Teto por categoria: é o que impede alguém de fechar as 100 h só com leitura.
const { categorias } = await marina('/api/eu');
const cat = (nome) => categorias.find((c) => c.nome === nome)?.id;
await marina(`/api/cursos/${curso.id}/regras`, {
  metodo: 'PUT',
  corpo: {
    regras: [
      { categoria_id: cat('Observação em campo'), limite_horas: 40 },
      { categoria_id: cat('Leitura / fichamento'), percentual_max: 20 },
      { categoria_id: cat('Seminário / evento'), limite_horas: 30 },
    ].filter((r) => r.categoria_id),
  },
});

// --- as turmas (salas) e as matérias dentro delas
const manha = await marina('/api/turmas', {
  metodo: 'POST',
  corpo: {
    nome: '4º período — Psicologia',
    materia: 'Técnicas de Observação',
    periodo: '2026.1 — manhã',
    curso_id: curso.id,
  },
});
const noite = await marina('/api/turmas', {
  metodo: 'POST',
  corpo: {
    nome: '3º período — Psicologia',
    materia: 'Técnicas de Observação',
    periodo: '2026.1 — noite',
    curso_id: curso.id,
  },
});
const seminario = (await marina('/api/materias', {
  metodo: 'POST', corpo: { turma_id: manha.turma.id, nome: 'Seminário de Pesquisa' },
})).materia;

// A colega entra com convite e abre a matéria dela na sala da Marina.
const convite = (await marina('/api/convites', {
  metodo: 'POST', corpo: { observacao: 'Profa. Helena — estágio' },
})).convite;
const helena = await entrarComoProfessor(
  'Profa. Helena Duarte', 'helena@exemplo.br', convite.codigo, 'Faculdade Exemplo',
);
const estagio = (await helena('/api/materias', {
  metodo: 'POST',
  corpo: { codigo_turma: manha.turma.codigo, nome: 'Estágio Supervisionado I', conta_horas: true },
})).materia;

const observacaoManha = manha.materias[0];
const observacaoNoite = noite.materias[0];

// --- os alunos
const turmaDe = { manha: manha.turma.codigo, noite: noite.turma.codigo };
const alunos = {};
for (const [nome, email, sala, matricula] of [
  ['Ana Ribeiro', 'ana@exemplo.br', 'manha', '2026001'],
  ['Bruno Tavares', 'bruno@exemplo.br', 'manha', '2026002'],
  ['Carla Nunes', 'carla@exemplo.br', 'manha', '2026003'],
  ['Diego Prado', 'diego@exemplo.br', 'manha', '2026004'],
  ['Elisa Monteiro', 'elisa@exemplo.br', 'noite', '2025011'],
  ['Fábio Rocha', 'fabio@exemplo.br', 'noite', '2025012'],
]) {
  alunos[nome] = await entrarComoAluno(nome, email, turmaDe[sala], matricula);
}

// --- as aulas da Marina: a mesma aula serve as duas turmas
const aula1 = (await marina('/api/aulas', {
  metodo: 'POST',
  corpo: {
    materia_ids: [observacaoManha.id, observacaoNoite.id],
    titulo: 'Aula 1 — O que é observar',
    data_aula: dia(-21),
    descricao: 'Diferença entre ver e observar. Leia o capítulo 2 antes do próximo encontro.',
    arquivo: anexo('aula-1-o-que-e-observar.pdf', 'Aula 1 — O que é observar', [
      'Observar e olhar com uma pergunta na mao.',
      '1. O que eu quero saber?',
      '2. Onde e quando isso acontece?',
      '3. Como registro sem interpretar cedo demais?',
    ]),
  },
})).aula;

const aula2 = (await marina('/api/aulas', {
  metodo: 'POST',
  corpo: {
    materia_ids: [observacaoManha.id, observacaoNoite.id],
    titulo: 'Aula 2 — Registro cursivo',
    data_aula: dia(-7),
    descricao: 'Como registrar em texto corrido, sem categorias prontas.',
    arquivo: anexo('aula-2-registro-cursivo.pdf', 'Aula 2 — Registro cursivo', [
      'Escreva no presente, na ordem em que aconteceu.',
      'Separe o que voce viu do que voce achou.',
      'Anote a hora a cada mudanca de cena.',
    ]),
  },
})).aula;

await marina('/api/materiais', {
  metodo: 'POST',
  corpo: {
    materia_id: observacaoManha.id,
    aula_id: aula2.id,
    tipo: 'link',
    titulo: 'Exemplo de registro comentado (site da biblioteca)',
    url: 'https://exemplo.br/registro-comentado',
  },
});

const tarefaRegistro = (await marina('/api/tarefas', {
  metodo: 'POST',
  corpo: {
    aula_id: aula2.id,
    titulo: 'Registro da observação 2',
    enunciado: 'Uma página de registro cursivo da sua segunda ida a campo. '
      + 'Anexe o registro em PDF ou escreva aqui mesmo.',
    prazo: dia(3),
    nota_maxima: 10,
  },
})).tarefa;

const fichamento = (await marina('/api/tarefas', {
  metodo: 'POST',
  corpo: {
    aula_id: aula1.id,
    titulo: 'Fichamento do capítulo 2',
    enunciado: 'Meia página com as três ideias que você levaria para o campo.',
    prazo: dia(-4),
    nota_maxima: 10,
  },
})).tarefa;

// Rascunho: aparece só para a professora, não para o aluno.
await marina('/api/aulas', {
  metodo: 'POST',
  corpo: {
    materia_ids: [observacaoManha.id],
    titulo: 'Aula 3 — Análise do registro (rascunho)',
    data_aula: dia(7),
    descricao: 'Ainda montando. O aluno não vê enquanto estiver como rascunho.',
    publicada: false,
  },
});

// --- o estágio da Helena, que gera horas complementares
const visita = (await helena('/api/aulas', {
  metodo: 'POST',
  corpo: {
    materia_ids: [estagio.id],
    titulo: 'Primeira visita ao campo',
    data_aula: dia(-14),
    descricao: 'Levar crachá, caderno e o termo assinado. Chegar 15 minutos antes.',
    arquivo: anexo('roteiro-da-visita.pdf', 'Roteiro da primeira visita', [
      'Apresente-se a coordenacao antes de entrar.',
      'Fique no canto da sala nos primeiros 20 minutos.',
      'Registre o ambiente antes de registrar as pessoas.',
    ]),
  },
})).aula;

const relatorio = (await helena('/api/tarefas', {
  metodo: 'POST',
  corpo: {
    aula_id: visita.id,
    titulo: 'Relatório da primeira visita',
    enunciado: 'Duas páginas: o que você viu, o que te surpreendeu e o que ficou como pergunta.',
    prazo: dia(-2),
    horas_sugeridas: 4,
    categoria_id: cat('Observação em campo'),
  },
})).tarefa;

// --- as entregas dos alunos
await alunos['Ana Ribeiro'](`/api/tarefas/${relatorio.id}/entrega`, {
  metodo: 'PUT',
  corpo: {
    texto: 'Cheguei às 8h. A sala tinha 22 crianças e duas professoras. '
      + 'Nos primeiros minutos ninguém reparou em mim; depois uma menina veio perguntar meu nome. '
      + 'O que me surpreendeu foi o quanto o barulho tem ritmo — sobe, alguém canta, e ele cai sozinho.',
  },
});
await alunos['Bruno Tavares'](`/api/tarefas/${relatorio.id}/entrega`, {
  metodo: 'PUT',
  corpo: {
    texto: 'Fui na terça de manhã. Anotei tudo no caderno e passei a limpo aqui. '
      + 'Ainda não consegui separar bem o que vi do que interpretei.',
    arquivo: anexo('relatorio-bruno.pdf', 'Relatório — Bruno Tavares', [
      'Visita de tercar-feira, das 8h as 10h.',
      'Registro em texto corrido, com horario a cada mudanca de cena.',
    ]),
  },
});
await alunos['Carla Nunes'](`/api/tarefas/${relatorio.id}/entrega`, {
  metodo: 'PUT',
  corpo: { texto: 'Segue meu relato da visita. Fiquei em dúvida se o tempo conta como horas.' },
});

// A professora corrige: uma aceita (vira hora validada), uma devolvida, uma na fila.
const fila = await helena(`/api/tarefas/${relatorio.id}/entregas`);
const entregaDe = (nome) => fila.entregas.find((e) => e.aluno_nome === nome);
await helena(`/api/entregas/${entregaDe('Ana Ribeiro').id}/avaliacao`, {
  metodo: 'POST',
  corpo: { status: 'aceita', horas: 4, observacao: 'Ótima separação entre o visto e o interpretado.' },
});
await helena(`/api/entregas/${entregaDe('Carla Nunes').id}/avaliacao`, {
  metodo: 'POST',
  corpo: {
    status: 'devolvida',
    observacao: 'Está curto demais. Reescreva contando a cena em ordem, com horário.',
  },
});

// O fichamento já corrigido com nota — a disciplina não gera hora complementar.
await alunos['Ana Ribeiro'](`/api/tarefas/${fichamento.id}/entrega`, {
  metodo: 'PUT',
  corpo: {
    texto: 'Três ideias: observar é escolher o que olhar; o registro é parte do método; '
      + 'a interpretação vem depois, e por escrito.',
  },
});
await alunos['Bruno Tavares'](`/api/tarefas/${fichamento.id}/entrega`, {
  metodo: 'PUT', corpo: { texto: 'Fichamento do capítulo 2, com as passagens que destaquei.' },
});
const doFichamento = await marina(`/api/tarefas/${fichamento.id}/entregas`);
const fichamentoDe = (nome) => doFichamento.entregas.find((e) => e.aluno_nome === nome);
await marina(`/api/entregas/${fichamentoDe('Ana Ribeiro').id}/avaliacao`, {
  metodo: 'POST',
  corpo: { status: 'aceita', nota: 9, observacao: 'A terceira ideia ficou muito bem colocada.' },
});
await marina(`/api/entregas/${fichamentoDe('Bruno Tavares').id}/avaliacao`, {
  metodo: 'POST',
  corpo: { status: 'aceita', nota: 7.5, observacao: 'Boa leitura; falta dizer o que leva a campo.' },
});

// Uma entrega na disciplina da Marina, ainda esperando correção.
await alunos['Ana Ribeiro'](`/api/tarefas/${tarefaRegistro.id}/entrega`, {
  metodo: 'PUT',
  corpo: { texto: 'Registro da segunda ida a campo, em texto corrido.' },
});

// --- horas lançadas pelos próprios alunos, em vários estados da fila
const lancar = (quem, dados) => alunos[quem]('/api/atividades', { metodo: 'POST', corpo: dados });

await lancar('Ana Ribeiro', {
  titulo: 'Congresso de Psicologia do Desenvolvimento',
  categoria_id: cat('Seminário / evento'),
  local: 'Centro de Convenções',
  responsavel: 'Comissão organizadora',
  data_atividade: dia(-40),
  data_fim: dia(-38),
  horas: 12,
  comprovante: 'Certificado 2026/114',
  texto: 'Três dias de mesas sobre primeira infância. A mesa de sexta mudou meu recorte de campo.',
  arquivo: anexo('certificado-congresso.pdf', 'Certificado de participacao', [
    'Certificamos que Ana Ribeiro participou do',
    'Congresso de Psicologia do Desenvolvimento,',
    'com carga horaria de 12 horas.',
  ]),
});
await lancar('Bruno Tavares', {
  titulo: 'Monitoria de Estatística',
  categoria_id: cat('Supervisão'),
  local: 'Bloco C, sala 12',
  responsavel: 'Prof. Ricardo',
  data_atividade: dia(-60),
  horas: 20,
  texto: 'Duas horas por semana atendendo os alunos do 2º período.',
});
await lancar('Carla Nunes', {
  titulo: 'Fichamento — Vigotski, capítulo 4',
  categoria_id: cat('Leitura / fichamento'),
  data_atividade: dia(-15),
  horas: 6,
  texto: 'Fichamento completo do capítulo, com as passagens sobre mediação.',
});
await lancar('Diego Prado', {
  titulo: 'Projeto de extensão — Roda de conversa na UBS',
  categoria_id: cat('Extensão / projeto'),
  local: 'UBS Vila Nova',
  responsavel: 'Assistente social Márcia',
  data_atividade: dia(-30),
  horas: 16,
  texto: 'Quatro encontros com o grupo de mães.',
});
await lancar('Elisa Monteiro', {
  titulo: 'Observação livre no pátio da escola',
  categoria_id: cat('Observação em campo'),
  local: 'EMEI Vila Nova',
  data_atividade: dia(-10),
  horas: 3,
  texto: 'Registro do recreio, com foco em brincadeira paralela.',
});

// A professora valida uma, devolve outra para correção e deixa o resto na fila.
const daEquipe = await helena('/api/atividades');
const atividadeDe = (titulo) => daEquipe.atividades.find((a) => a.titulo.startsWith(titulo));
await helena(`/api/atividades/${atividadeDe('Congresso').id}/analise`, {
  metodo: 'POST',
  corpo: { status: 'aprovado', horas_aprovadas: 12, observacao: 'Certificado conferido.' },
});
await helena(`/api/atividades/${atividadeDe('Fichamento').id}/analise`, {
  metodo: 'POST',
  corpo: { status: 'correcao', motivo: 'Faltou anexar o fichamento. Reenvie com o texto completo.' },
});

// --- o caderno da professora sobre os alunos (o aluno não vê)
const turma = await helena('/api/turma');
const alunoId = (nome) => turma.alunos.find((a) => a.nome === nome)?.id;
await helena(`/api/alunos/${alunoId('Carla Nunes')}/anotacoes`, {
  metodo: 'POST',
  corpo: {
    texto: 'Faltou nos dois últimos encontros de campo. Combinamos reposição no dia 12, '
      + 'com a coordenação da UBS avisada.',
  },
});
await marina(`/api/alunos/${alunoId('Diego Prado')}/anotacoes`, {
  metodo: 'POST',
  corpo: { texto: 'Trabalha à noite; pediu para entregar os registros até domingo. Combinado.' },
});

// --- um convite ainda em aberto e uma chave de integração, para as telas de
// configuração não aparecerem vazias
await marina('/api/convites', { metodo: 'POST', corpo: { observacao: 'Prof. Ricardo — estatística' } });
const chave = await marina('/api/chaves', { metodo: 'POST', corpo: { nome: 'Portal de Exercícios' } });

// ---------------------------------------------------------------- resumo

const linha = '─'.repeat(64);
console.log(`
${linha}
  Demonstração no ar:  ${alvo || `http://localhost:${PORTA}`}
  Banco:               ${alvo ? 'o banco publicado (D1)' : 'data/demo.db  (refeito a cada "npm run demo")'}
${linha}

  ENTRE COMO PROFESSORA  (senha de todo mundo: ${SENHA})

    marina@exemplo.br    Profa. Marina Alves — também é a administradora
                         Técnicas de Observação (4º manhã e 3º noite) — tarefas
                         valendo nota; e Seminário de Pesquisa (4º manhã)

    helena@exemplo.br    Profa. Helena Duarte — entrou na sala da Marina
                         Estágio Supervisionado I — esta gera horas
                         tem 1 entrega para corrigir e 2 horas para validar

  ENTRE COMO ALUNO

    ana@exemplo.br       entregou tudo; nota 9 na disciplina e 16 h validadas
    carla@exemplo.br     teve a entrega devolvida e uma hora em correção
    diego@exemplo.br     lançou extensão, esperando na fila
    elisa@exemplo.br     turma da noite, sem estágio — não vê a parte de horas

  CÓDIGOS DAS SALAS

    ${manha.turma.codigo}   4º período — Psicologia (2026.1 manhã)
    ${noite.turma.codigo}   3º período — Psicologia (2026.1 noite)

  Chave de integração criada: ${chave.token}

  ${alvo
    ? 'Os dados ficaram no banco publicado. Para começar limpo de novo:\n'
      + '  npx wrangler d1 execute horas-complementares --remote --file=scripts/limpar.sql'
    : 'Ctrl+C encerra. Rodar de novo apaga tudo e monta outra vez.'}
${linha}
`);

// Montada em outro lugar, não há servidor local para segurar de pé.
if (alvo) process.exit(0);
