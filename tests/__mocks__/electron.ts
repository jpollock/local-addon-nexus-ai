export const ipcMain = {
  handle: jest.fn(),
  removeHandler: jest.fn(),
};

export const BrowserWindow = {
  getAllWindows: jest.fn(() => []),
};
