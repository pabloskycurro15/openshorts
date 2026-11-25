import { Shell } from './components/Shell';
import { ConnectScreen } from './components/ConnectScreen';
import { useConnection } from './lib/connection';
import { useHashRoute } from './lib/router';
import { useSettings } from './lib/settings';
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

export function App() {
  const { status } = useConnection();
  const { appearance } = useSettings();
  const [route, navigate] = useHashRoute('inicio');
  const section = sectionById(route) ?? SECTIONS[0]!;

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
      default: return <PlannedSection section={section} />;
    }
  })();

  return (
    <div className="jarvis-bg h-full" data-grid={appearance.grid}>
      {status === 'no-token' || status === 'unauthorized' ? (
        <ConnectScreen />
      ) : (
        <Shell route={section.id} navigate={navigate}>{content}</Shell>
      )}
    </div>
  );
}
