// Entrada do Cloudflare Workers. Os arquivos de public/ são servidos pela
// própria plataforma (assets); aqui só passam as chamadas /api/*.

import { adaptarD1 } from './src/d1.js';
import { lerCookies, usuarioDaSessao } from './src/auth.js';
import { criarRotas, despachar, ErroHttp } from './src/api.js';

const json = (corpo, status = 200, cabecalhos = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cabecalhos },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : json({ erro: 'Página não encontrada.' }, 404);
    }

    const bd = adaptarD1(env.DB);
    const rotas = criarRotas(bd, { iteracoesSenha: env.ITERACOES_SENHA });

    try {
      const token = lerCookies(request.headers.get('cookie')).sessao;
      const usuario = await usuarioDaSessao(bd, token);

      let corpo = {};
      if (request.method !== 'GET' && request.method !== 'DELETE') {
        const bruto = await request.text();
        if (bruto) {
          try {
            const dados = JSON.parse(bruto);
            if (dados && typeof dados === 'object') corpo = dados;
          } catch {
            throw new ErroHttp(400, 'JSON inválido.');
          }
        }
      }

      const resultado = await despachar(rotas, {
        metodo: request.method,
        url,
        corpo,
        token,
        usuario,
        seguro: url.protocol === 'https:',
        exigirLogin() {
          if (!usuario) throw new ErroHttp(401, 'Faça login para continuar.');
          return usuario;
        },
      });

      if (resultado.csv !== undefined) {
        return new Response(resultado.csv, { headers: resultado.cabecalhos });
      }
      return json(resultado.corpo, resultado.status || 200, resultado.cabecalhos);
    } catch (e) {
      if (e instanceof ErroHttp) return json({ erro: e.message }, e.status);
      console.error('Erro inesperado:', e);
      return json({ erro: 'Erro interno do servidor.' }, 500);
    }
  },
};
