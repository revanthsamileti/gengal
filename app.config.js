// Extends app.json with what depends on the build environment.
const fs = require('fs');

// Firebase's Android config, which push notifications need: without it the
// app cannot get a Firebase token and no call or message notification can
// reach the phone. It is kept out of the public repo. EAS builds receive it
// through the GOOGLE_SERVICES_JSON file environment variable (EAS writes the
// file and passes its path); a local checkout can place google-services.json
// in the project root.
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ||
  (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);

// Preview APKs are sideloaded onto test phones, which are all 64-bit, so they
// carry only the arm64 native libraries: about a quarter of the size of a
// universal APK (the Agora SDK alone ships tens of MB per ABI). Store builds
// keep every ABI, since plenty of low-cost phones in India are still 32-bit.
module.exports = ({ config }) => {
  const withFirebase = googleServicesFile
    ? { ...config, android: { ...config.android, googleServicesFile } }
    : config;
  if (process.env.EAS_BUILD_PROFILE !== 'preview') return withFirebase;
  return {
    ...withFirebase,
    plugins: [
      ...(withFirebase.plugins ?? []),
      ['expo-build-properties', { android: { buildArchs: ['arm64-v8a'] } }],
    ],
  };
};
