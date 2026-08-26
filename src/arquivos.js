// Armazenamento de arquivo com três destinos e a mesma interface:
//
//   disco  — desenvolvimento local (data/arquivos)
//   R2     — produção, quando o bucket está ligado no wrangler.toml
//   D1     — produção sem R2: guarda o conteúdo no próprio banco
//
// O D1 existe para o sistema funcionar assim que o deploy sobe, sem depender de
// criar bucket. Ele cobra o preço de um limite de tamanho bem menor.

export const LIMITE_R2 = 8 * 1024 * 1024;
export const LIMITE_D1 = 700 * 1024;

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
  return {
    nome: 'd1',
    limite: LIMITE_D1,
    async guardar(chave, bytes) {
      await bd.run(
        'INSERT INTO arquivos_conteudo(chave, conteudo) VALUES(?, ?) ON CONFLICT(chave) DO UPDATE SET conteudo = excluded.conteudo',
        chave,
        bytes,
      );
    },
    async ler(chave) {
      const linha = await bd.get('SELECT conteudo FROM arquivos_conteudo WHERE chave = ?', chave);
      if (!linha) return null;
      return linha.conteudo instanceof Uint8Array ? linha.conteudo : new Uint8Array(linha.conteudo);
    },
    async remover(chave) {
      await bd.run('DELETE FROM arquivos_conteudo WHERE chave = ?', chave);
    },
  };
}
