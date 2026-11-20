import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const derive = promisify(scrypt);
const lifetime = 30 * 24 * 60 * 60 * 1000;
const hashToken = (value) => createHash('sha256').update(value).digest('hex');
const normalizeName = (value) => String(value || '').trim().toLowerCase();

function validAccount(username, password) {
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error('账号名须为 3 至 32 位英文、数字或下划线');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('密码须为 12 至 128 个字符');
}

async function passwordHash(password, salt) {
  return (await derive(password, salt, 64)).toString('hex');
}

async function matches(password, user) {
  const actual = Buffer.from(await passwordHash(password, user.salt), 'hex');
  return timingSafeEqual(actual, Buffer.from(user.password_hash, 'hex'));
}

export async function createAuth(root, secure) {
  await fs.mkdir(root, { recursive: true });
  const db = new DatabaseSync(path.join(root, 'accounts.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  const cookieName = secure ? '__Host-yingxing-session' : 'yingxing-session';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: lifetime };
  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
  const findById = db.prepare('SELECT * FROM users WHERE id = ?');

  function tokenFrom(req) {
    const value = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
    return value ? value.slice(cookieName.length + 1) : null;
  }

  function session(req) {
    const token = tokenFrom(req);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const user = db.prepare('SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hashToken(token), Date.now());
    return user || null;
  }

  function issueSession(res, user) {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, Date.now() + lifetime);
    res.cookie(cookieName, token, cookieOptions);
    return { id: user.id, username: user.username };
  }

  async function register({ username: input, password }, res) {
    const username = normalizeName(input);
    validAccount(username, password);
    if (findUser.get(username)) throw new Error('账号名已被使用');
    const id = randomUUID();
    const salt = randomBytes(16).toString('hex');
    const recoveryCode = randomBytes(24).toString('base64url');
    const hash = await passwordHash(password, salt);
    try {
      db.prepare('INSERT INTO users(id, username, salt, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, username, salt, hash, hashToken(recoveryCode), Date.now());
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new Error('账号名已被使用');
      throw error;
    }
    return { user: issueSession(res, { id, username }), recoveryCode };
  }

  async function login({ username: input, password }, res) {
    const username = normalizeName(input);
    const user = findUser.get(username);
    if (!user || typeof password !== 'string' || !(await matches(password, user))) throw new Error('账号或密码不正确');
    return { user: issueSession(res, user) };
  }

  async function recover({ username: input, recoveryCode, password }, res) {
    const username = normalizeName(input);
    validAccount(username, password);
    const user = findUser.get(username);
    if (!user || typeof recoveryCode !== 'string' || recoveryCode.length !== 32 ||
      !timingSafeEqual(Buffer.from(hashToken(recoveryCode), 'hex'), Buffer.from(user.recovery_hash, 'hex'))) {
      throw new Error('账号或恢复码不正确');
    }
    const salt = randomBytes(16).toString('hex');
    const hash = await passwordHash(password, salt);
    const nextRecoveryCode = randomBytes(24).toString('base64url');
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET salt = ?, password_hash = ?, recovery_hash = ? WHERE id = ?')
        .run(salt, hash, hashToken(nextRecoveryCode), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { user: issueSession(res, user), recoveryCode: nextRecoveryCode };
  }

  function logout(req, res) {
    const token = tokenFrom(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    res.clearCookie(cookieName, { path: '/', sameSite: 'strict', secure });
  }

  async function deleteAccount(userId, password, req, res) {
    const user = findById.get(userId);
    if (!user || typeof password !== 'string' || !(await matches(password, user))) throw new Error('密码不正确');
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    logout(req, res);
    return user;
  }

  return { session, register, login, recover, logout, deleteAccount };
}
