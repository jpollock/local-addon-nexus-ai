export const ipcMain = {
  handle: jest.fn(),
  removeHandler: jest.fn(),
};

export const BrowserWindow = {
  getAllWindows: jest.fn(() => []),
};

export const safeStorage = {
  isEncryptionAvailable: jest.fn(() => true),
  /**
   * Simulate encryption by prepending "enc:" to the value.
   * This keeps tests deterministic while exercising the full KeyVault code path.
   */
  encryptString: jest.fn((value: string): Buffer => Buffer.from(`enc:${value}`)),
  decryptString: jest.fn((buf: Buffer): string => {
    const str = buf.toString();
    if (str.startsWith('enc:')) return str.slice(4);
    return str;
  }),
};
