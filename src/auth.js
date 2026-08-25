// Senhas e sessões usando só Web Crypto — a mesma implementação roda no Node
// e no Cloudflare Workers (que não tem node:crypto/scrypt).

const DIAS_SESSAO = 30;

// O custo do PBKDF2 fica gravado dentro do próprio hash, então dá para aumentar
// as iterações depois sem invalidar as senhas já cadastradas.
export const ITERACOES_PADRAO = 10_000;

const bytesParaHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const hexParaBytes = (hex) =>
  Uint8Array.from(hex.match(/.{1,2}/g) ?? [], (par) => parseInt(par, 16));

const aleatorio = (tamanho) => crypto.getRandomValues(new Uint8Array(tamanho));

async function derivar(senha, sal, iteracoes) {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(senha),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes },
    chave,
    256,
  );
  return new Uint8Array(bits);
}

export async function gerarHash(senha, iteracoes = ITERACOES_PADRAO) {
  const sal = aleatorio(16);
  const derivada = await derivar(senha, sal, iteracoes);
  return `pbkdf2$${iteracoes}$${bytesParaHex(sal)}$${bytesParaHex(derivada)}`;
}

export async function conferirSenha(senha, hashArmazenado) {
  const partes = String(hashArmazenado).split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const iteracoes = Number(partes[1]);
  if (!Number.isInteger(iteracoes) || iteracoes <= 0) return false;

  const guardada = hexParaBytes(partes[3]);
  const tentativa = await derivar(senha, hexParaBytes(partes[2]), iteracoes);
  return comparacaoConstante(tentativa, guardada);
}

// Comparação em tempo constante: crypto.timingSafeEqual não existe no Workers.
function comparacaoConstante(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

export async function criarSessao(bd, usuarioId) {
  const token = bytesParaHex(aleatorio(32));
  const agora = new Date();
  const expira = new Date(agora.getTime() + DIAS_SESSAO * 24 * 60 * 60 * 1000);
  await bd.run(
    'INSERT INTO sessoes(token, usuario_id, criado_em, expira_em) VALUES(?, ?, ?, ?)',
    token,
    usuarioId,
    agora.toISOString(),
    expira.toISOString(),
  );
  return { token, expira };
}

export async function encerrarSessao(bd, token) {
  if (token) await bd.run('DELETE FROM sessoes WHERE token = ?', token);
}

export async function usuarioDaSessao(bd, token) {
  if (!token) return null;
  await bd.run('DELETE FROM sessoes WHERE expira_em < ?', new Date().toISOString());
  return bd.get(
    `SELECT u.id, u.nome, u.email, u.papel, u.turma_id, u.matricula, u.instituicao, t.nome AS turma_nome, t.codigo AS turma_codigo
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
       LEFT JOIN turmas t ON t.id = u.turma_id
      WHERE s.token = ?`,
    token,
  );
}

export function lerCookies(cabecalho) {
  const cookies = {};
  if (!cabecalho) return cookies;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    cookies[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return cookies;
}

export function cookieDeSessao(token, expira, seguro = false) {
  const base = `sessao=${token}; Path=/; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`;
  return expira ? `${base}; Expires=${expira.toUTCString()}` : `${base}; Max-Age=0`;
}
