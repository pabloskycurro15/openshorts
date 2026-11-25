/** Información que expone la app de escritorio (preload). Ausente en el navegador. */
export interface DesktopBridge {
  token: string;
  version: string;
  platform: string;
}

export function desktop(): DesktopBridge | null {
  return (window as unknown as { jarvisDesktop?: DesktopBridge }).jarvisDesktop ?? null;
}
