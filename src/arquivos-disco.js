// Destino de arquivos para quando o sistema roda no seu computador.
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIMITE_R2 } from './arquivos.js';

export function armazenamentoDisco(pasta = path.join(process.cwd(), 'data', 'arquivos')) {
  const caminho = (chave) => path.join(pasta, chave.replace(/[^a-zA-Z0-9._-]/g, '_'));
  return {
    nome: 'disco',
    limite: LIMITE_R2,
    async guardar(chave, bytes) {
      await fs.mkdir(pasta, { recursive: true });
      await fs.writeFile(caminho(chave), bytes);
    },
    async ler(chave) {
      try {
        return new Uint8Array(await fs.readFile(caminho(chave)));
      } catch {
        return null;
      }
    },
    async remover(chave) {
      await fs.rm(caminho(chave), { force: true });
    },
  };
}
