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
  bruto = execFileSync('npx', argumentos, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
} catch {
  console.error('\nNão consegui consultar o banco. Confira se o `npx wrangler login` já foi feito.');
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
