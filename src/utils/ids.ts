/**
 * Room / channel identifiers are used directly as Agora channel names, so a
 * collision drops two unrelated pairs of users into the same call. The previous
 * `Math.random().toString(36).substring(7)` produced ~5 characters (~1.6M
 * combinations), which collides in practice at even modest concurrency.
 */
const randomChunk = () => Math.random().toString(36).slice(2, 10);

export const generateRoomId = () =>
  `r${Date.now().toString(36)}${randomChunk()}${randomChunk()}`;
