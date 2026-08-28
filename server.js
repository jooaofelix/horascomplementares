// Servidor para rodar no seu computador (ou na rede da faculdade).
// A versão publicada no Cloudflare usa worker.js, com as mesmas rotas.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bancoLocal } from './src/sqlite.js';
import { armazenamentoDisco } from './src/arquivos-disco.js';
import { lerCookies, usuarioDaSessao } from './src/auth.js';
import { criarRotas, despachar, ErroHttp, erroDeBancoAtrasado, AVISO_BANCO_ATRASADO } from './src/api.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');
// Arquivos chegam em base64 dentro do JSON, o que engorda o corpo em ~1/3.
const LIMITE_CORPO = 14 * 1024 * 1024;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function responderJson(res, status, corpo, cabecalhos = {}) {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(dados),
    ...cabecalhos,
  });
  res.end(dados);
}

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

function servirEstatico(res, caminhoUrl) {
  const relativo = caminhoUrl === '/' ? 'index.html' : caminhoUrl.slice(1);
  const arquivo = path.join(PUBLICO, relativo);
  if (!arquivo.startsWith(PUBLICO + path.sep)) {
    return responderJson(res, 403, { erro: 'Caminho inválido.' });
  }
  fs.readFile(arquivo, (err, conteudo) => {
    if (err) return responderJson(res, 404, { erro: 'Página não encontrada.' });
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(conteudo);
  });
}

export function criarServidor(bd = bancoLocal(), opcoes = {}) {
  const rotas = criarRotas(bd, {
    iteracoesSenha: process.env.ITERACOES_SENHA,
    arquivos: opcoes.arquivos ?? armazenamentoDisco(),
  });

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return responderJson(res, 405, { erro: 'Método não permitido.' });
      return servirEstatico(res, url.pathname);
    }

    try {
      const token = lerCookies(req.headers.cookie).sessao;
      const usuario = await usuarioDaSessao(bd, token);
      const corpo = req.method === 'GET' || req.method === 'DELETE' ? {} : await lerCorpo(req);

      const resultado = await despachar(rotas, {
        metodo: req.method,
        url,
        corpo,
        token,
        usuario,
        autorizacao: req.headers.authorization,
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress,
        seguro: false, // servidor local roda em http://
        exigirLogin() {
          if (!usuario) throw new ErroHttp(401, 'Faça login para continuar.');
          return usuario;
        },
      });

      if (resultado.csv !== undefined) {
        res.writeHead(200, { ...resultado.cabecalhos, 'Content-Length': Buffer.byteLength(resultado.csv) });
        return res.end(resultado.csv);
      }
      if (resultado.binario !== undefined) {
        const corpo = Buffer.from(resultado.binario);
        res.writeHead(200, { ...resultado.cabecalhos, 'Content-Length': corpo.length });
        return res.end(corpo);
      }
      responderJson(res, resultado.status || 200, resultado.corpo, resultado.cabecalhos);
    } catch (e) {
      if (e instanceof ErroHttp) return responderJson(res, e.status, { erro: e.message });
      console.error('Erro inesperado:', e);
      responderJson(res, 500, {
        erro: erroDeBancoAtrasado(e) ? AVISO_BANCO_ATRASADO : 'Erro interno do servidor.',
      });
    }
  });

  servidor.on('close', () => bd.fechar?.());
  return servidor;
}

const executadoDireto = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDireto) {
  const porta = Number(process.env.PORT) || 3000;
  criarServidor().listen(porta, () => {
    console.log(`Horas complementares rodando em http://localhost:${porta}`);
  });
}
