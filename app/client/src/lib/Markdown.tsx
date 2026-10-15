import { Fragment, type ReactNode } from 'react';

// Minimal, safe Markdown renderer (no raw HTML). Supports headings (#, ##, ###),
// bullet and numbered lists, paragraphs, and inline **bold** / `code`.
// Used for module overview paragraphs and AI answers.

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** and `code` while keeping delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>,
      );
    } else if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(
        <code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part) {
      nodes.push(<Fragment key={i}>{part}</Fragment>);
    }
  });
  return nodes;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key++} className="ml-5 list-decimal space-y-1.5">
          {items}
        </ol>
      ) : (
        <ul key={key++} className="ml-5 list-disc space-y-1.5">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);

    if (h) {
      flushList();
      const level = h[1].length;
      const content = renderInline(h[2]);
      if (level === 1) blocks.push(<h2 key={key++} className="mt-4 text-xl font-bold text-foreground">{content}</h2>);
      else if (level === 2) blocks.push(<h3 key={key++} className="mt-4 text-lg font-semibold text-foreground">{content}</h3>);
      else blocks.push(<h4 key={key++} className="mt-3 text-base font-semibold text-foreground">{content}</h4>);
    } else if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else {
      flushList();
      blocks.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }
  flushList();

  return <div className={`space-y-3 leading-relaxed text-muted-foreground ${className ?? ''}`}>{blocks}</div>;
}
