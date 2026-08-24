export interface HermesDesktopAPI {
  isDesktop: boolean;
  platform: string;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  toggleAlwaysOnTop: () => Promise<boolean>;
  getAlwaysOnTop: () => Promise<boolean>;
  openExternal: (url: string) => void;
  triggerVoiceWake: () => void;
  restartBackend: () => void;
  getAppVersion: () => Promise<string>;
  onWindowStateChange?: (callback: (state: any) => void) => () => void;
  onVoiceStateUpdate?: (callback: (state: string) => void) => () => void;
}

declare global {
  interface Window {
    hermesDesktop?: HermesDesktopAPI;
  }
}
