// Armazenamento de arquivo com três destinos e a mesma interface:
//
//   disco  — desenvolvimento local (data/arquivos)
//   R2     — produção, quando o bucket está ligado no wrangler.toml
//   D1     — produção sem R2: guarda o conteúdo no próprio banco
//
// O D1 existe para o sistema funcionar assim que o deploy sobe, sem depender de
// criar bucket. Ele cobra o preço de um limite de tamanho bem menor.

export const LIMITE_R2 = 8 * 1024 * 1024;
// Cada parte fica bem abaixo do teto de ~1 MB por valor do D1.
export const TAMANHO_PARTE = 600 * 1024;
export const LIMITE_D1 = 6 * 1024 * 1024;

export function armazenamentoR2(bucket) {
  return {
    nome: 'r2',
    limite: LIMITE_R2,
    async guardar(chave, bytes, tipo) {
      await bucket.put(chave, bytes, { httpMetadata: { contentType: tipo } });
    },
    async ler(chave) {
      const objeto = await bucket.get(chave);
      return objeto ? new Uint8Array(await objeto.arrayBuffer()) : null;
    },
    async remover(chave) {
      await bucket.delete(chave);
    },
  };
}

export function armazenamentoD1(bd) {
  const paraBytes = (valor) => (valor instanceof Uint8Array ? valor : new Uint8Array(valor));

  return {
    nome: 'd1',
    limite: LIMITE_D1,

    async guardar(chave, bytes) {
      await bd.run('DELETE FROM arquivos_partes WHERE chave = ?', chave);
      for (let parte = 0, inicio = 0; inicio < bytes.length; parte++, inicio += TAMANHO_PARTE) {
        await bd.run(
          'INSERT INTO arquivos_partes(chave, parte, conteudo) VALUES(?, ?, ?)',
          chave, parte, bytes.slice(inicio, inicio + TAMANHO_PARTE),
        );
      }
    },

    async ler(chave) {
      const partes = await bd.all(
        'SELECT conteudo FROM arquivos_partes WHERE chave = ? ORDER BY parte', chave,
      );
      if (partes.length) {
        const pedacos = partes.map((p) => paraBytes(p.conteudo));
        const inteiro = new Uint8Array(pedacos.reduce((total, p) => total + p.length, 0));
        let posicao = 0;
        for (const pedaco of pedacos) {
          inteiro.set(pedaco, posicao);
          posicao += pedaco.length;
        }
        return inteiro;
      }
      // Arquivos guardados antes do fatiamento continuam legíveis.
      const antigo = await bd.get('SELECT conteudo FROM arquivos_conteudo WHERE chave = ?', chave);
      return antigo ? paraBytes(antigo.conteudo) : null;
    },

    async remover(chave) {
      await bd.run('DELETE FROM arquivos_partes WHERE chave = ?', chave);
      await bd.run('DELETE FROM arquivos_conteudo WHERE chave = ?', chave);
    },
  };
}
