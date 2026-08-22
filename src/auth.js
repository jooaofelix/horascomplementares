import crypto from 'node:crypto';

const DIAS_SESSAO = 30;

export function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const derivada = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${derivada}`;
}

export function conferirSenha(senha, hashArmazenado) {
  const [sal, derivada] = String(hashArmazenado).split(':');
  if (!sal || !derivada) return false;
  const tentativa = crypto.scryptSync(senha, sal, 64);
  const guardada = Buffer.from(derivada, 'hex');
  return tentativa.length === guardada.length && crypto.timingSafeEqual(tentativa, guardada);
}

export function criarSessao(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expira = new Date(agora.getTime() + DIAS_SESSAO * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessoes(token, usuario_id, criado_em, expira_em) VALUES(?, ?, ?, ?)').run(
    token,
    usuarioId,
    agora.toISOString(),
    expira.toISOString(),
  );
  return { token, expira };
}

export function encerrarSessao(db, token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

export function usuarioDaSessao(db, token) {
  if (!token) return null;
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(new Date().toISOString());
  const linha = db
    .prepare(
      `SELECT u.id, u.nome, u.email, u.papel
         FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ?`,
    )
    .get(token);
  return linha || null;
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

export function cookieDeSessao(token, expira) {
  const base = `sessao=${token}; Path=/; HttpOnly; SameSite=Lax`;
  return expira ? `${base}; Expires=${expira.toUTCString()}` : `${base}; Max-Age=0`;
}
