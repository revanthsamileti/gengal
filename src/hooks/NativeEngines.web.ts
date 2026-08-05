export const getAgoraEngine = () => {
  return {
    createAgoraRtcEngine: () => {
      console.warn("Agora RTC Engine is not supported on web.");
      return {
        initialize: () => {},
        enableAudio: () => {},
        enableVideo: () => {},
        startPreview: () => {},
        registerEventHandler: () => {},
        joinChannel: () => 0,
        leaveChannel: () => {},
        release: () => {},
      };
    }
  };
};
