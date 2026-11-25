import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import './styles/theme.css';
import { App } from './App';
import { ConnectionProvider } from './lib/connection';
import { SettingsProvider } from './lib/settings';
import { VoiceProvider } from './voice/VoiceProvider';
import { registerServiceWorker } from './lib/push';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ConnectionProvider>
        <VoiceProvider>
          <App />
        </VoiceProvider>
      </ConnectionProvider>
    </SettingsProvider>
  </StrictMode>,
);
