// Extends app.json. Only adds what depends on the EAS build profile.
//
// Preview APKs are sideloaded onto test phones, which are all 64-bit, so they
// carry only the arm64 native libraries: about a quarter of the size of a
// universal APK (the Agora SDK alone ships tens of MB per ABI). Store builds
// keep every ABI, since plenty of low-cost phones in India are still 32-bit.
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PROFILE !== 'preview') return config;
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['expo-build-properties', { android: { buildArchs: ['arm64-v8a'] } }],
    ],
  };
};
