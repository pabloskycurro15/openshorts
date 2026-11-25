import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom no implementa canvas: el núcleo visual debe tolerar un contexto nulo.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.location.hash = '';
});
