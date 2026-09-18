// Aplica no banco publicado as migrações que ainda faltam.
//
// Rodar de novo é seguro: quando um arquivo falha por já ter sido aplicado (a
// coluna existe, a tabela existe), ele é reexecutado comando a comando e só os
// passos realmente novos entram.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PASTA = 'migracoes';
const BANCO = 'horas-complementares';
const TOLERAVEL = /duplicate column name|already exists|já existe/i;

// O -y é o que impede a migração de parecer travada: sem ele o wrangler para
// para perguntar "Ok to proceed?" antes de cada arquivo, e como a saída dele
// vem para cá em vez de ir para a tela, a pergunta fica invisível e o script
// fica esperando uma resposta que ninguém sabe que precisa dar.
//
// A saída continua capturada de propósito: é lendo o erro que sabemos se o
// arquivo falhou por já ter sido aplicado (e aí refazemos comando a comando)
// ou por um problema de verdade. Sem stdin, também não há como travar.
const wrangler = (args) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', BANCO, '--remote', '-y', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

// Divide o arquivo em comandos, deixando os comentários de fora.
function comandos(sql) {
  return sql
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function aplicarPassoAPasso(caminho) {
  let aplicados = 0;
  let pulados = 0;
  for (const comando of comandos(fs.readFileSync(caminho, 'utf8'))) {
    try {
      wrangler(['--command', comando]);
      aplicados++;
    } catch (e) {
      const saida = [e.stdout, e.stderr].filter(Boolean).join('\n');
      if (TOLERAVEL.test(saida)) {
        pulados++;
        continue;
      }
      console.error(`\n  ✗ falhou em:\n    ${comando.slice(0, 120).replace(/\s+/g, ' ')}\n`);
      console.error(saida.trim());
      process.exit(1);
    }
  }
  return { aplicados, pulados };
}

const arquivos = fs.readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();
console.log(`\nAplicando migrações em ${BANCO} (${arquivos.length} arquivos)\n`);

for (const arquivo of arquivos) {
  const caminho = path.join(PASTA, arquivo);
  process.stdout.write(`  ${arquivo} … `);
  try {
    wrangler(['--file', caminho]);
    console.log('aplicada');
  } catch {
    // Já aplicada no todo ou em parte: refaz comando a comando.
    const { aplicados, pulados } = aplicarPassoAPasso(caminho);
    console.log(aplicados ? `${aplicados} passo(s) novo(s), ${pulados} já existia(m)` : 'já estava aplicada');
  }
}

console.log('\nBanco atualizado. Agora: npm run deploy\n');
