import { useEffect, useState } from 'react';
import { Copy, LogOut, ShieldCheck, Trash2, X } from 'lucide-react';
import { api, json } from './api';
import './auth.css';

export default function AuthGate({ App }) {
  const [session, setSession] = useState(null);
  const [view, setView] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/session').then((result) => setSession(result?.mode ? result : { mode: 'local', user: null })).catch((failure) => {
      if (failure.message.includes('(404)')) setSession({ mode: 'local', user: null });
      else setError(failure.message);
    });
    const unauthorized = () => setSession((current) => current?.mode === 'public' ? { ...current, user: null } : current);
    window.addEventListener('yingxing:unauthorized', unauthorized);
    return () => window.removeEventListener('yingxing:unauthorized', unauthorized);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const endpoint = view === 'register' ? '/auth/register' : view === 'recover' ? '/auth/recover' : '/auth/login';
      const result = await api(endpoint, json('POST', { username, password, recoveryCode: recoveryInput }));
      setPassword('');
      setRecoveryInput('');
      setSession({ mode: 'public', user: result.user });
      setRecoveryCode(result.recoveryCode || '');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    setError('');
    setBusy(true);
    try {
      await api('/auth/logout', json('POST', {}));
      setSession({ mode: 'public', user: null });
      setAccountOpen(false);
      setView('login');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function deleteAccount(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/auth/account', json('DELETE', { password: deletePassword }));
      localStorage.removeItem(`yingxing.models.${session.user.id}`);
      setDeletePassword('');
      setSession({ mode: 'public', user: null });
      setAccountOpen(false);
      setView('login');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  if (!session) return <div className="auth-loading" role="status">{error || '正在连接源笔记…'}</div>;

  if (recoveryCode) return (
    <main className="auth-shell">
      <div className="auth-brand"><span className="auth-mark">✦</span>源笔记</div>
      <section className="auth-panel">
        <ShieldCheck size={27} className="auth-symbol" />
        <h1>保存恢复码</h1>
        <p>此恢复码只显示一次。忘记密码时，需要用它设置新密码；重置后会生成新的恢复码。</p>
        <div className="auth-recovery"><code>{recoveryCode}</code><button type="button" title="复制恢复码" aria-label="复制恢复码" onClick={() => navigator.clipboard.writeText(recoveryCode)}><Copy size={17} /></button></div>
        <button className="primary-button auth-submit" onClick={() => setRecoveryCode('')}>继续使用</button>
      </section>
    </main>
  );

  if (session.mode === 'local' || session.user) return (
    <>
      <App key={session.user?.id || 'local'} account={session.user} onAccount={() => { setError(''); setAccountOpen(true); }} />
      {accountOpen && session.user && <div className="modal-backdrop" role="presentation">
        <section className="modal auth-account" role="dialog" aria-modal="true" aria-label="账号设置">
          <div className="modal-head"><h2>账号</h2><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setAccountOpen(false)}><X size={18} /></button></div>
          <p><strong>{session.user.username}</strong></p>
          <a className="secondary-button" href="/api/backup" download>下载我的资料备份</a>
          <button className="secondary-button auth-logout" disabled={busy} onClick={logout}><LogOut size={16} /> 退出登录</button>
          <form className="auth-delete" onSubmit={deleteAccount}>
            <h3>删除账号与资料</h3>
            <p>此操作会删除账号、资料、笔记和图片。请先下载备份。</p>
            <label>当前密码<input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required /></label>
            <button className="danger-button" disabled={busy || !deletePassword}><Trash2 size={16} /> 删除账号</button>
          </form>
          {error && <p className="error-line" role="alert">{error}</p>}
        </section>
      </div>}
    </>
  );

  return <main className="auth-shell">
    <div className="auth-brand"><span className="auth-mark">✦</span>源笔记</div>
    <section className="auth-panel">
      <h1>{view === 'register' ? '创建账号' : view === 'recover' ? '重置密码' : '登录'}</h1>
      {view !== 'recover' && <div className="auth-tabs" role="group" aria-label="账号操作">
        <button type="button" className={view === 'login' ? 'active' : ''} onClick={() => { setView('login'); setError(''); }}>登录</button>
        <button type="button" className={view === 'register' ? 'active' : ''} onClick={() => { setView('register'); setError(''); }}>注册</button>
      </div>}
      <form onSubmit={submit}>
        <label>账号名<input autoComplete="username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" required /></label>
        {view === 'recover' && <label>恢复码<input autoComplete="off" value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value.trim())} required /></label>}
        <label>{view === 'recover' ? '新密码' : '密码'}<input type="password" autoComplete={view === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={view === 'login' ? undefined : 12} required /></label>
        {view === 'register' && <p className="auth-hint">密码至少 12 位。注册后请保存恢复码。</p>}
        {error && <p className="error-line" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? '请稍候…' : view === 'register' ? '创建账号' : view === 'recover' ? '设置新密码' : '登录'}</button>
      </form>
      {view === 'login' && <button type="button" className="auth-link" onClick={() => { setView('recover'); setError(''); }}>忘记密码？</button>}
      {view === 'recover' && <button type="button" className="auth-link" onClick={() => { setView('login'); setError(''); }}>返回登录</button>}
    </section>
  </main>;
}
