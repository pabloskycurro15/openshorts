import { Fragment, type ReactNode } from 'react';

/**
 * Renderizado mínimo y seguro de Markdown (sin HTML crudo): párrafos, listas,
 * bloques de código, **negrita**, *cursiva* y `código`. Suficiente para respuestas de chat.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${i++}`;
    if (t.startsWith('`')) out.push(<code key={k} className="rounded bg-bg/70 px-1 py-0.5 font-mono text-[0.85em] text-amber-200">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k} className="font-semibold text-ink">{t.slice(2, -2)}</strong>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, pi) => {
    if (pi % 2 === 1) {
      const code = part.replace(/^[a-zA-Z0-9_-]*\n/, '');
      blocks.push(<pre key={`c${pi}`} className="my-2 overflow-x-auto rounded-lg bg-bg/80 p-3 font-mono text-xs text-ink">{code.replace(/\n$/, '')}</pre>);
      return;
    }
    const lines = part.split('\n');
    let list: { ordered: boolean; items: string[] } | null = null;
    let para: string[] = [];
    const flushPara = (k: string) => {
      if (para.length) blocks.push(<p key={k} className="my-1.5">{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, `${k}-${i}`)}</Fragment>)}</p>);
      para = [];
    };
    const flushList = (k: string) => {
      if (!list) return;
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>);
      blocks.push(list.ordered
        ? <ol key={k} className="my-1.5 list-decimal space-y-0.5 pl-5">{items}</ol>
        : <ul key={k} className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-accent">{items}</ul>);
      list = null;
    };
    lines.forEach((line, li) => {
      const k = `p${pi}-${li}`;
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      const h = /^#{1,4}\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara(k + 'p');
        const ordered = !!ol;
        if (list && list.ordered !== ordered) flushList(k + 'l');
        list ??= { ordered, items: [] };
        list.items.push((ul ?? ol)![1]!);
      } else if (h) {
        flushPara(k + 'p');
        flushList(k + 'l');
        blocks.push(<p key={k} className="mt-3 mb-1 font-semibold text-ink">{inline(h[1]!, k)}</p>);
      } else if (!line.trim()) {
        flushPara(k + 'p');
        flushList(k + 'l');
      } else {
        flushList(k + 'l');
        para.push(line);
      }
    });
    flushPara(`end${pi}p`);
    flushList(`end${pi}l`);
  });
  return <div className="text-sm leading-relaxed text-ink/95">{blocks}</div>;
}
