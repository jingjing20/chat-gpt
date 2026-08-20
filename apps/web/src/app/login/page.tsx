'use client';

import { login, register } from '@/lib/chat-api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiClientError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result =
        mode === 'login'
          ? await login(email, password)
          : await register(email, password);
      queryClient.setQueryData(queryKeys.currentUser, result.user);
      router.replace('/chat');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : '暂时无法登录，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <p className="brand-mark">LUCIDRA</p>
        <h1>让每一次思考，都清晰可循。</h1>
        <p>与 AI 深入对话，随时回来继续。你的对话会安全保存在专属空间中。</p>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-tabs" role="tablist" aria-label="认证方式">
          <button
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login');
              setError('');
            }}
            role="tab"
            type="button"
          >
            登录
          </button>
          <button
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register');
              setError('');
            }}
            role="tab"
            type="button"
          >
            注册
          </button>
        </div>
        <h2 id="auth-title">
          {mode === 'login' ? '欢迎回来' : '创建你的账户'}
        </h2>
        <p className="auth-hint">
          {mode === 'login' ? '登录后继续你的对话' : '注册后即可开始新的对话'}
        </p>
        <form onSubmit={submit}>
          <label>
            邮箱
            <input
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            <span className="field-label">
              密码
              {mode === 'register' ? <small>至少 12 个字符</small> : null}
            </span>
            <span className="password-field">
              <input
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={mode === 'register' ? 12 : undefined}
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'login' ? '请输入密码' : '请设置密码'}
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                className="password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                title={showPassword ? '隐藏密码' : '显示密码'}
                type="button"
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" size={17} />
                ) : (
                  <Eye aria-hidden="true" size={17} />
                )}
              </button>
            </span>
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="primary-button"
            disabled={submitting}
            type="submit"
          >
            {submitting ? '请稍候…' : mode === 'login' ? '登录' : '创建账户'}
          </button>
        </form>
      </section>
    </main>
  );
}
