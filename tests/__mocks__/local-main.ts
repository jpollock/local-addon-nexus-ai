export const LocalMain = {
  getServiceContainer: () => ({
    cradle: {
      localLogger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
      userData: {
        get: jest.fn(),
        set: jest.fn(),
        remove: jest.fn(),
      },
      siteData: {
        getSite: jest.fn(),
        getSites: jest.fn(() => ({})),
      },
      siteProcessManager: {
        getSiteStatus: jest.fn(),
      },
    },
  }),
  registerLightningService: jest.fn(),
};
