import { Children, isValidElement, type ReactNode } from 'react';
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

export function SafeMarkdown({ content }: { content: string }) {
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
