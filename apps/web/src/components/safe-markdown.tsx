import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export function SafeMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown skipHtml rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
