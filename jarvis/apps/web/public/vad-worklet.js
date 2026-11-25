/* global AudioWorkletProcessor, registerProcessor */
// Captura de audio del micrófono a 16 kHz en bloques de 100 ms (1600 muestras).
// Todo ocurre en el equipo: estos datos nunca salen del navegador.
class JarvisCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1600);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('jarvis-capture', JarvisCapture);
