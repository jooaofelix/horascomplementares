import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from './src/db.js';
import { lerCookies, usuarioDaSessao } from './src/auth.js';
import { criarRotas, ErroHttp, responderJson } from './src/api.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');
const LIMITE_CORPO = 6 * 1024 * 1024; // análises longas cabem; acima disso é abuso

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let tamanho = 0;
    req.on('data', (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > LIMITE_CORPO) {
        reject(new ErroHttp(413, 'Conteúdo grande demais.'));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on('end', () => {
      const bruto = Buffer.concat(pedacos).toString('utf8');
      if (!bruto) return resolve({});
      try {
        const dados = JSON.parse(bruto);
        resolve(dados && typeof dados === 'object' ? dados : {});
      } catch {
        reject(new ErroHttp(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function servirEstatico(req, res, caminhoUrl) {
  const relativo = caminhoUrl === '/' ? 'index.html' : caminhoUrl.slice(1);
  const arquivo = path.join(PUBLICO, relativo);
  if (!arquivo.startsWith(PUBLICO + path.sep) && arquivo !== path.join(PUBLICO, 'index.html')) {
    responderJson(res, 403, { erro: 'Caminho inválido.' });
    return;
  }
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) {
      responderJson(res, 404, { erro: 'Página não encontrada.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(conteudo);
  });
}

export function criarServidor(db = abrirBanco()) {
  const rotas = criarRotas(db);

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return responderJson(res, 405, { erro: 'Método não permitido.' });
      return servirEstatico(req, res, url.pathname);
    }

    try {
      const token = lerCookies(req.headers.cookie).sessao;
      const usuario = usuarioDaSessao(db, token);

      const rota = rotas.find(([metodo, padrao]) => metodo === req.method && padrao.test(url.pathname));
      if (!rota) throw new ErroHttp(404, 'Rota não encontrada.');

      const corpo = req.method === 'GET' || req.method === 'DELETE' ? {} : await lerCorpo(req);
      const parametros = url.pathname.match(rota[1]).slice(1);

      const resultado = rota[2]({
        req,
        url,
        corpo,
        parametros,
        token,
        usuario,
        exigirLogin() {
          if (!usuario) throw new ErroHttp(401, 'Faça login para continuar.');
          return usuario;
        },
      });

      if (resultado.csv !== undefined) {
        res.writeHead(200, {
          ...resultado.cabecalhos,
          'Content-Length': Buffer.byteLength(resultado.csv),
        });
        res.end(resultado.csv);
        return;
      }
      responderJson(res, resultado.status || 200, resultado.corpo, resultado.cabecalhos);
    } catch (e) {
      if (e instanceof ErroHttp) return responderJson(res, e.status, { erro: e.message });
      console.error('Erro inesperado:', e);
      responderJson(res, 500, { erro: 'Erro interno do servidor.' });
    }
  });

  servidor.on('close', () => db.close());
  return servidor;
}

const executadoDireto = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDireto) {
  const porta = Number(process.env.PORT) || 3000;
  criarServidor().listen(porta, () => {
    console.log(`Horas complementares rodando em http://localhost:${porta}`);
  });
}
