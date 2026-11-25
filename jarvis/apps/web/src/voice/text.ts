/**
 * Prepara texto en Markdown para ser leído en voz alta: quita formato, sustituye
 * los bloques de código por un aviso y normaliza espacios.
 */
export function speakableText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' He dejado un bloque de código en pantalla. ')
    .replace(/```[\s\S]*$/g, ' ') // bloque sin cerrar (aún en streaming)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'el enlace en pantalla')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trocea texto que llega en streaming en frases completas, para empezar a hablar
 * cuanto antes sin cortar palabras. No corta dentro de un bloque de código.
 */
export class SentenceChunker {
  private buf = '';

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    const boundary = /([.!?…:;]["»”)]?)(\s+)|\n{2,}/g;
    let cutFrom = 0;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(this.buf))) {
      // Nunca cortar dentro de un bloque de código (número impar de ``` antes del punto).
      if ((this.buf.slice(0, m.index).match(/```/g)?.length ?? 0) % 2 === 1) continue;
      const end = m.index + m[0].length;
      const sentence = this.buf.slice(cutFrom, end);
      // Evitar cortes tras abreviaturas o fragmentos muy cortos («Sr.», «Sí.»): seguir acumulando.
      if (sentence.trim().length < 12 && !/\n{2,}$/.test(sentence)) continue;
      out.push(sentence);
      cutFrom = end;
    }
    this.buf = this.buf.slice(cutFrom);
    return out.map(speakableText).filter(Boolean);
  }

  flush(): string[] {
    const rest = speakableText(this.buf);
    this.buf = '';
    return rest ? [rest] : [];
  }
}
