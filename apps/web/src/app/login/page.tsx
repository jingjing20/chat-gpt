'use client';

import { login, register } from '@/lib/chat-api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiClientError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        <p className="brand-mark">CONCURRENT CHAT</p>
        <h1>把每段思考，留在自己的空间里。</h1>
        <p>阶段 2 已支持安全登录、持久化对话、消息分页和严格的用户数据隔离。</p>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-tabs" role="tablist" aria-label="认证方式">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
            type="button"
          >
            登录
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
            type="button"
          >
            注册
          </button>
        </div>
        <h2 id="auth-title">{mode === 'login' ? '欢迎回来' : '创建账户'}</h2>
        <p className="auth-hint">
          {mode === 'login' ? '使用你的邮箱继续对话' : '密码至少需要 12 个字符'}
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
            密码
            <input
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              minLength={12}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 12 个字符"
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="primary-button"
            disabled={submitting}
            type="submit"
          >
            {submitting
              ? '请稍候…'
              : mode === 'login'
                ? '登录并继续'
                : '注册并开始'}
          </button>
        </form>
      </section>
    </main>
  );
}
