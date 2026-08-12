'use client';

import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { MermaidDiagram } from './mermaid-diagram';
import { CodeBlock } from './code-block';

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-[\w-]+$/, /^hljs(?:-[\w-]+)?$/],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ['className', /^hljs(?:-[\w-]+)?$/],
    ],
  },
};

const STREAM_RENDER_INTERVAL_MS = 120;

export const SafeMarkdown = memo(function SafeMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const [throttledContent, setThrottledContent] = useState(content);
  const latestContentRef = useRef(content);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latestContentRef.current = content;
    if (!streaming) {
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
      setThrottledContent(content);
      return;
    }
    if (renderTimerRef.current) return;
    renderTimerRef.current = setTimeout(() => {
      setThrottledContent(latestContentRef.current);
      renderTimerRef.current = null;
    }, STREAM_RENDER_INTERVAL_MS);
  }, [content, streaming]);
  useEffect(
    () => () => {
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    },
    [],
  );
  const renderedContent = streaming ? throttledContent : content;

  return (
    <div className="markdown-content">
      <ReactMarkdown
        components={{
          code({ children, className, ...props }) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            const child = Children.only(children);
            if (
              !isValidElement<{ className?: string; children?: ReactNode }>(
                child,
              )
            ) {
              return <pre>{children}</pre>;
            }
            const language = /language-([\w-]+)/.exec(
              child.props.className ?? '',
            )?.[1];
            if (language === 'mermaid') {
              return <MermaidDiagram chart={String(child.props.children)} />;
            }
            return (
              <CodeBlock language={language}>{child.props.children}</CodeBlock>
            );
          },
          a({ children, ...props }) {
            return (
              <a {...props} rel="noreferrer noopener" target="_blank">
                {children}
              </a>
            );
          },
        }}
        rehypePlugins={[
          [rehypeHighlight, { detect: false, exclude: ['mermaid'] }],
          [rehypeSanitize, sanitizeSchema],
        ]}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
});
