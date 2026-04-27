// Minimal Electron type stub for TypeScript compilation.
// The real electron module is provided by the Local host app at runtime.
declare module 'electron' {
  export const safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
  };

  export const app: {
    getPath(name: string): string;
    getName(): string;
    getVersion(): string;
    quit(): void;
    on(event: string, listener: (...args: any[]) => void): any;
    whenReady(): Promise<void>;
  };

  export const ipcMain: {
    on(channel: string, listener: (event: any, ...args: any[]) => void): any;
    handle(channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any): any;
    removeHandler(channel: string): void;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<string>;
  };
}
