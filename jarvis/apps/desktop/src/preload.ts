/**
 * Puente mínimo y de solo lectura entre la ventana y la app de escritorio.
 * La ventana no tiene acceso a Node ni a Electron: solo recibe el token del núcleo.
 */
import { contextBridge, ipcRenderer } from 'electron';

const boot = ipcRenderer.sendSync('jarvis:bootstrap') as { token: string; version: string; platform: string } | null;
if (boot) {
  contextBridge.exposeInMainWorld('jarvisDesktop', Object.freeze({ token: boot.token, version: boot.version, platform: boot.platform }));
}
