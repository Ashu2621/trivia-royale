/*
 * Arena — picks the renderer for the Hot Seat studio: the Three.js 3D studio when WebGL works,
 * otherwise the original 2D canvas map. Both expose the same API.
 */
const Arena = (function () {
  'use strict';
  let impl = null;

  function mount(canvas, hooks) {
    const force2d = /[?&]arena2d\b/.test(location.search);
    if (!force2d && typeof THREE !== 'undefined' && typeof Arena3D !== 'undefined') {
      try {
        Arena3D.mount(canvas, hooks);
        impl = Arena3D;
      } catch (err) {
        console.warn('3D studio unavailable, using the 2D map', err);
        impl = null;
      }
    }
    if (!impl) {
      Arena2D.mount(canvas, hooks);
      impl = Arena2D;
    }
  }

  const call = (name) => (...a) => (impl ? impl[name](...a) : undefined);
  return {
    mount,
    start: call('start'),
    stop: call('stop'),
    resize: call('resize'),
    startMatch: call('startMatch'),
    startQuestion: call('startQuestion'),
    lock: call('lock'),
    reveal: call('reveal'),
    transition: call('transition'),
    setMe: call('setMe'),
    react: call('react'),
    say: call('say'),
    setFans: call('setFans'),
    tableAt: call('tableAt'),
    aliveCount: (...a) => (impl ? impl.aliveCount(...a) : 0),
    toggleOverview: call('toggleOverview'),
    get is3d() { return impl === (typeof Arena3D !== 'undefined' ? Arena3D : null); },
  };
})();
