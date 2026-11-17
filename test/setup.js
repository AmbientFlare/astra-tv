// The Vega preset's requestAnimationFrame calls jest.now(), which this
// version of Jest does not have, so any animation that runs in a test throws.
global.requestAnimationFrame = (callback) =>
  setTimeout(() => callback(Date.now()), 0);
