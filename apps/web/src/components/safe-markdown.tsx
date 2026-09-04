'use client';

import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { MermaidDiagram } from './mermaid-diagram';
import { CodeBlock } from './code-block';

type MarkdownNode = {
  children?: MarkdownNode[];
  type?: string;
  value?: string;
};

function remarkSoftBreaks() {
  return (tree: MarkdownNode) => {
    replaceTextSoftBreaks(tree);
  };
}

function replaceTextSoftBreaks(node: MarkdownNode) {
  if (!node.children) return;

  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || !child.value?.includes('\n')) {
      replaceTextSoftBreaks(child);
      return [child];
    }

    return child.value.split('\n').flatMap((value, index) => {
      const nodes: MarkdownNode[] = [];
      if (index > 0) nodes.push({ type: 'break' });
      if (value) nodes.push({ ...child, value });
      return nodes;
    });
  });
}

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
        remarkPlugins={[remarkGfm, remarkSoftBreaks]}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
