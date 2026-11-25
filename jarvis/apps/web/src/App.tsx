import { Shell } from './components/Shell';
import { ConnectScreen } from './components/ConnectScreen';
import { useConnection } from './lib/connection';
import { useHashRoute } from './lib/router';
import { ACCENTS, useSettings } from './lib/settings';
import { Starfield } from './components/Starfield';
import { SECTIONS, sectionById } from './sections/registry';
import { HomeSection } from './sections/Home';
import { MonitorSection } from './sections/Monitor';
import { SecuritySection } from './sections/Security';
import { HistorySection } from './sections/History';
import { NotificationsSection } from './sections/Notifications';
import { LabSection } from './sections/Lab';
import { CommandsSection } from './sections/Commands';
import { SettingsSection } from './sections/Settings';
import { PlannedSection } from './sections/Planned';
import { ConversationSection } from './sections/Conversation';
import { FilesSection } from './sections/Files';
import { MemorySection } from './sections/Memory';
import { TasksSection } from './sections/Tasks';
import { AgentsSection } from './sections/Agents';
import { ConnectorsSection } from './sections/Connectors';

import { useEffect } from 'react';

export function App() {
  const { status } = useConnection();
  const { appearance } = useSettings();
  const [route, navigate] = useHashRoute('inicio');
  const section = sectionById(route) ?? SECTIONS[0]!;

  // Activación por voz desde cualquier sección: llevar a Inicio, donde la barra recoge la orden.
  useEffect(() => {
    const on = () => { if (section.id !== 'inicio' && section.id !== 'conversacion') navigate('inicio'); };
    window.addEventListener('jarvis:wake', on);
    return () => window.removeEventListener('jarvis:wake', on);
  }, [section.id, navigate]);

  const content = (() => {
    switch (section.id) {
      case 'inicio': return <HomeSection navigate={navigate} />;
      case 'monitor': return <MonitorSection />;
      case 'seguridad': return <SecuritySection />;
      case 'historial': return <HistorySection />;
      case 'notificaciones': return <NotificationsSection />;
      case 'laboratorio': return <LabSection />;
      case 'comandos': return <CommandsSection />;
      case 'configuracion': return <SettingsSection />;
      case 'archivos': return <FilesSection />;
      case 'memoria': return <MemorySection />;
      case 'tareas': return <TasksSection />;
      case 'agentes': return <AgentsSection />;
      case 'conectores': return <ConnectorsSection />;
      case 'conversacion': return <ConversationSection navigate={navigate} />;
      default: return <PlannedSection section={section} />;
    }
  })();

  return (
    <div className="jarvis-bg holo-scanlines relative h-full" data-grid={appearance.grid}>
      <Starfield accent={ACCENTS[appearance.accent].hex} motion={appearance.motion} />
      <div className="relative z-10 h-full">
        {status === 'no-token' || status === 'unauthorized' ? (
          <ConnectScreen />
        ) : (
          <Shell route={section.id} navigate={navigate}><div key={section.id} className="section-enter h-full">{content}</div></Shell>
        )}
      </div>
    </div>
  );
}
