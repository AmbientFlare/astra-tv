module.exports = {
  dependency: {
    platforms: {
      kepler: {
        autolink: {
          AstraUserEngagement: {
            libraryName: 'libAstraUserEngagement.so',
            linkDynamic: true,
            provider: 'application',
            components: [],
            turbomodules: ['AstraUserEngagement'],
          },
        },
      },
    },
  },
};
