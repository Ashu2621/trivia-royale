/*
 * City — picks the renderer for City Mission: the Three.js 3D world when WebGL works,
 * otherwise the original 2D canvas renderer. Both expose the same API.
 */
const City = (function () {
  'use strict';
  let impl = null;

  function mount(canvas, mini, joy, knob, hooks) {
    const force2d = /[?&]city2d\b/.test(location.search);
    if (!force2d && typeof THREE !== 'undefined' && typeof City3D !== 'undefined' && typeof CityWorld !== 'undefined') {
      try {
        City3D.mount(canvas, mini, joy, knob, hooks);
        impl = City3D;
      } catch (err) {
        console.warn('3D city unavailable, using the 2D view', err);
        impl = null;
      }
    }
    if (!impl) {
      City2D.mount(canvas, mini, joy, knob, hooks);
      impl = City2D;
    }
  }

  return {
    mount,
    start: (...a) => impl.start(...a),
    stop: () => impl && impl.stop(),
    applyState: (s) => impl && impl.applyState(s),
    zapFx: (...a) => impl && impl.zapFx(...a),
    say: (...a) => impl && impl.say(...a),
    floatText: (...a) => impl && impl.floatText(...a),
    fx: (...a) => impl && impl.fx && impl.fx(...a),
    resume: () => impl && impl.resume && impl.resume(),
    get running() { return !!impl && impl.running; },
    get me() { return impl ? impl.me : { x: 0, y: 0 }; },
    get cam() { return impl && impl.cam; },
    get missions() { return (impl && impl.missions) || []; },
    walkTo: (x, y) => impl && impl.walkTo && impl.walkTo(x, y),
    get is3d() { return impl === (typeof City3D !== 'undefined' ? City3D : null); },
  };
})();
