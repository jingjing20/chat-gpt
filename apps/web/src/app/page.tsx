const services = [
  {
    name: 'Web',
    detail: 'Next.js 16 · React 19',
    status: 'ready',
  },
  {
    name: 'API',
    detail: 'NestJS 11 · REST / Event Gateway',
    status: 'ready',
  },
  {
    name: 'Worker',
    detail: 'NestJS 11 · Generation Worker',
    status: 'ready',
  },
] as const;

export default function Home() {
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

  return (
    <main className="shell">
      <section className="hero">
        <div className="phase-pill">
          <span className="phase-dot" aria-hidden="true" />
          阶段 0 · 工程基线
        </div>
        <p className="eyebrow">CONCURRENT CHAT</p>
        <h1>多对话并发流式 AI 聊天系统</h1>
        <p className="lede">
          当前仓库已经完成 Web、API、Worker 与本地基础设施的工程分层。
          下一阶段将从用户认证和数据隔离开始。
        </p>
      </section>

      <section className="service-grid" aria-label="服务状态">
        {services.map((service) => (
          <article className="service-card" key={service.name}>
            <div className="card-heading">
              <h2>{service.name}</h2>
              <span>{service.status}</span>
            </div>
            <p>{service.detail}</p>
          </article>
        ))}
      </section>

      <section className="next-step">
        <div>
          <p className="eyebrow">LOCAL API</p>
          <h2>{apiBaseUrl}</h2>
        </div>
        <code>pnpm infra:up &amp;&amp; pnpm dev</code>
      </section>
    </main>
  );
}
