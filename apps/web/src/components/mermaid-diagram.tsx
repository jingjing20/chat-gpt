'use client';

import { useEffect, useId, useState } from 'react';

export function MermaidDiagram({ chart }: { chart: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const render = async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          suppressErrorRendering: true,
          themeVariables: {
            primaryColor: '#18261f',
            primaryTextColor: '#eef7f2',
            primaryBorderColor: '#67dda0',
            lineColor: '#91a098',
            secondaryColor: '#111815',
            tertiaryColor: '#0b0f0d',
          },
        });
        const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const result = await mermaid.render(id, chart);
        if (active) setSvg(result.svg);
      } catch {
        if (active) setFailed(true);
      }
    };
    void render();
    return () => {
      active = false;
    };
  }, [chart, reactId]);

  if (failed) {
    return (
      <div className="mermaid-error">
        <p>流程图语法有误，已显示原始内容。</p>
        <pre>
          <code>{chart}</code>
        </pre>
      </div>
    );
  }
  if (!svg) return <div className="mermaid-loading">正在绘制流程图…</div>;

  return (
    <div
      aria-label="Mermaid 流程图"
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
    />
  );
}
