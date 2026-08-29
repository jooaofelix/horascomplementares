// Aviso por e-mail, sem biblioteca nenhuma: é uma chamada HTTP para o serviço
// de envio. Roda igual no Node e no Worker, porque só usa fetch.
//
// Sem chave configurada o sistema continua funcionando por inteiro — ele apenas
// não avisa ninguém. Nunca é o e-mail que derruba um envio de aluno.

const PADRAO = 'https://api.resend.com/emails';

export function criarEmail({ chave, de, url = PADRAO, responderPara } = {}) {
  const ativo = Boolean(chave && de);

  return {
    ativo,
    de,

    async enviar({ para, assunto, texto, anexos = [] }) {
      const destinos = (Array.isArray(para) ? para : [para]).filter(Boolean);
      if (!ativo) return { enviado: false, motivo: 'e-mail não configurado' };
      if (!destinos.length) return { enviado: false, motivo: 'sem destinatário' };

      const resposta = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: de,
          to: destinos,
          subject: assunto,
          text: texto,
          // O professor recebe o próprio documento, não só o aviso de que ele
          // existe: dá para ler o relatório sem abrir o sistema.
          ...(anexos.length
            ? { attachments: anexos.map((a) => ({ filename: a.nome, content: a.conteudo })) }
            : {}),
          ...(responderPara ? { reply_to: responderPara } : {}),
        }),
      });
      if (!resposta.ok) {
        throw new Error(`o serviço de e-mail recusou (${resposta.status}): ${await resposta.text()}`);
      }
      return { enviado: true, destinos };
    },
  };
}

// Lê a configuração de onde ela estiver: process.env no computador, env do
// Worker na Cloudflare.
export const emailDoAmbiente = (fonte = {}) =>
  criarEmail({
    chave: fonte.EMAIL_CHAVE || fonte.RESEND_API_KEY,
    de: fonte.EMAIL_DE,
    url: fonte.EMAIL_URL || PADRAO,
    responderPara: fonte.EMAIL_RESPONDER_PARA,
  });
