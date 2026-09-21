import type {
  ClientMessage,
  SeatAssignment,
  ServerMessage,
  SettingsLoaded,
} from '../../../core/src/messages.js';
import type { OfficeLayout } from '../office/types.js';
import type { MessageTransport } from './types.js';

export const PREVIEW_STORAGE_KEY = 'pixel-agents:studio-preview:v1';
export const PREVIEW_DEFAULT_SETTINGS: SettingsLoaded = {
  type: 'settingsLoaded',
  soundEnabled: false,
  lastSeenVersion: '1.4',
  extensionVersion: '1.4.1',
  watchAllSessions: false,
  alwaysShowLabels: false,
  ghostHeadlessAgents: false,
  hooksEnabled: false,
  hooksInfoShown: true,
  externalAssetDirectories: [],
  showAreas: false,
};
interface PreviewState {
  layout?: OfficeLayout;
  seats?: Record<string, SeatAssignment>;
  settings?: Partial<SettingsLoaded>;
  areaMappings?: Record<string, string[]>;
}

export function readPreviewState(storage: Pick<Storage, 'getItem'> = localStorage): PreviewState {
  try {
    const saved = JSON.parse(storage.getItem(PREVIEW_STORAGE_KEY) ?? '{}') as PreviewState;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    if (
      saved.layout &&
      (saved.layout.version !== 1 ||
        !Array.isArray(saved.layout.tiles) ||
        saved.layout.tiles.length !== saved.layout.cols * saved.layout.rows ||
        !Array.isArray(saved.layout.furniture))
    ) {
      delete saved.layout;
    }
    return saved;
  } catch {
    return {};
  }
}

/** Local editor backend for Vite's sandbox. Never queues commands for a missing WebSocket. */
export class PreviewTransport implements MessageTransport {
  readonly state = 'connected' as const;
  readonly ready = Promise.resolve();
  private handlers = new Set<(message: ServerMessage) => void>();
  private readonly onWindowMessage = (event: MessageEvent) => {
    if (event.data && typeof event.data.type === 'string')
      this.deliver(event.data as ServerMessage);
  };
  private storage: Storage;
  constructor(storage: Storage = localStorage) {
    this.storage = storage;
    window.addEventListener('message', this.onWindowMessage);
  }
  private deliver(message: ServerMessage) {
    this.handlers.forEach((handler) => handler(message));
  }
  send(message: ClientMessage): void {
    const saved = readPreviewState(this.storage);
    const settings = { ...PREVIEW_DEFAULT_SETTINGS, ...saved.settings };
    switch (message.type) {
      case 'saveLayout':
        saved.layout = message.layout as unknown as OfficeLayout;
        break;
      case 'saveAgentSeats':
        saved.seats = message.seats;
        break;
      case 'saveAreaMappings':
        saved.areaMappings = message.mappings;
        break;
      case 'setSoundEnabled':
        settings.soundEnabled = message.enabled;
        break;
      case 'setAlwaysShowLabels':
        settings.alwaysShowLabels = message.enabled;
        break;
      case 'setGhostHeadlessAgents':
        settings.ghostHeadlessAgents = message.enabled;
        break;
      case 'setShowAreas':
        settings.showAreas = message.enabled;
        break;
      case 'setLastSeenVersion':
        settings.lastSeenVersion = message.version;
        break;
      case 'closeAgent':
        this.deliver({ type: 'agentClosed', id: message.id });
        return;
      // App lifecycle and focus have no host-side work in the local sandbox.
      case 'webviewReady':
      case 'focusAgent':
      case 'setHooksInfoShown':
        return;
      default:
        return;
    }
    saved.settings = settings;
    try {
      this.storage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      window.alert(
        'Your browser could not save this change. Export the layout from Settings to keep a copy.',
      );
      return;
    }
    if (message.type === 'saveAreaMappings')
      this.deliver({ type: 'areaMappingsLoaded', mappings: message.mappings });
    if (message.type.startsWith('set')) this.deliver(settings);
  }
  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  onStateChange(): () => void {
    return () => {};
  }
  dispose(): void {
    window.removeEventListener('message', this.onWindowMessage);
    this.handlers.clear();
  }
}
