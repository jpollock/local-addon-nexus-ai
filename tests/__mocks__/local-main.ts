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
        getSiteByProperty: jest.fn(),
        addSite: jest.fn(),
        updateSite: jest.fn(),
        deleteSite: jest.fn(),
      },
      siteProcessManager: {
        start: jest.fn(),
        stop: jest.fn(),
        restart: jest.fn(),
        getSiteStatus: jest.fn(() => 'running'),
        getSiteStatuses: jest.fn(() => ({})),
        startSites: jest.fn(),
        stopSites: jest.fn(),
      },
      wpCli: {
        run: jest.fn(),
        getPlugins: jest.fn(() => []),
        getThemes: jest.fn(() => []),
        getWpVersion: jest.fn(() => '6.4.2'),
        getOption: jest.fn(),
        isInstalled: jest.fn(() => true),
      },
      addSite: {
        addSite: jest.fn(),
      },
      deleteSite: {
        deleteSite: jest.fn(),
      },
      cloneSite: {
        cloneSite: jest.fn(),
      },
      exportSite: {
        exportSite: jest.fn(),
      },
      siteDatabase: {
        dump: jest.fn(() => '/tmp/dump.sql'),
        runQuery: jest.fn(),
        getTablePrefix: jest.fn(() => 'wp_'),
      },
      capi: {
        getAccountList: jest.fn(() => []),
        getInstallList: jest.fn(() => []),
        getInstall: jest.fn(),
        createBackup: jest.fn(),
        purgeCache: jest.fn(),
        getSiteList: jest.fn(() => []),
      },
      x509CertService: {
        trustCert: jest.fn(),
      },
      lightningServices: {
        getAvailableServices: jest.fn(() => []),
      },
    },
  }),
  registerLightningService: jest.fn(),
};
