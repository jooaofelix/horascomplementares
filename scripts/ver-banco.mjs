// Mostra quantos registros existem em cada tabela do banco publicado.
//
// Usa subconsultas numa linha só em vez de UNION ALL: o D1 recusa compound
// SELECT com muitos termos ("too many terms in compound SELECT").

import { execFileSync } from 'node:child_process';

const TABELAS = [
  ['usuarios', 'pessoas'],
  ['cursos', 'cursos'],
  ['categorias', 'categorias'],
  ['regras_categoria', 'regras de limite'],
  ['turmas', 'turmas'],
  ['materias', 'matérias'],
  ['atividades', 'atividades de horas'],
  ['aulas', 'aulas'],
  ['materiais', 'materiais'],
  ['tarefas', 'tarefas'],
  ['entregas', 'entregas'],
  ['arquivos', 'arquivos'],
  ['convites', 'convites'],
  ['chaves_api', 'chaves de integração'],
  ['sessoes', 'sessões abertas'],
];

const sql = TABELAS
  .map(([tabela]) => `(SELECT COUNT(*) FROM ${tabela}) AS ${tabela}`)
  .join(', ');

const argumentos = [
  'wrangler', 'd1', 'execute', 'horas-complementares', '--remote', '--json',
  '--command', `SELECT ${sql}`,
];

let bruto;
try {
  // stdin herdado: sem um terminal à vista, o wrangler se declara não
  // interativo e passa a exigir CLOUDFLARE_API_TOKEN mesmo já estando logado.
  bruto = execFileSync('npx', argumentos, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
} catch (e) {
  // Mostrar o que o wrangler falou é o que permite entender a causa; engolir a
  // saída dele deixa quem roda no escuro.
  console.error('\nO wrangler não conseguiu consultar o banco. Ele respondeu:\n');
  const saida = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
  console.error(saida || `(sem saída) código ${e.status ?? '?'}`);
  console.error('\nSe falar em login, rode: npx wrangler login');
  console.error('Para consultar sem este atalho:');
  console.error(`  npx wrangler d1 execute horas-complementares --remote --command "SELECT ${sql}"`);
  process.exit(1);
}

const primeiro = (valor) => (Array.isArray(valor) ? primeiro(valor[0]) : valor);
const resposta = primeiro(JSON.parse(bruto.slice(bruto.indexOf('['))));
const linha = resposta?.results?.[0];

if (!linha) {
  console.log(bruto);
  process.exit(0);
}

const largura = Math.max(...TABELAS.map(([, rotulo]) => rotulo.length));
console.log('\nBanco horas-complementares (Cloudflare D1)\n');
for (const [tabela, rotulo] of TABELAS) {
  console.log(`  ${rotulo.padEnd(largura)}  ${String(linha[tabela] ?? 0).padStart(6)}`);
}
console.log('\nPara consultar em SQL:');
console.log('  npx wrangler d1 execute horas-complementares --remote --command "SELECT ..."\n');
