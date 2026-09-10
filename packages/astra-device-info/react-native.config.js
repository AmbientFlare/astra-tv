module.exports = {
  dependency: {
    platforms: {
      kepler: {
        autolink: {
          AstraDeviceInfo: {
            libraryName: 'libAstraDeviceInfo.so',
            linkDynamic: true,
            provider: 'application',
            components: [],
            turbomodules: ['AstraDeviceInfo'],
          },
        },
      },
    },
  },
};
