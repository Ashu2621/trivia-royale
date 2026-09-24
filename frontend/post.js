/*
 * Post — a small HDR post-processing pipeline for the Three.js scenes (no external add-ons):
 *
 *   scene -> multisampled half-float target -> bright-pass -> 4-level blurred bloom chain ->
 *   composite: bloom + ACES filmic tone mapping + colour grading + vignette + film grain +
 *   chromatic aberration and a red edge when you are hurt + desaturation at low health.
 *
 * Falls back to plain rendering (Post.create returns null) when WebGL2 float targets are missing.
 */
const Post = (function () {
  'use strict';

  const T = THREE;

  const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // bright pass with a soft knee, and a 4-tap box downsample so bloom does not flicker
  const EXTRACT = `
    uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee; varying vec2 vUv;
    vec3 fetch(vec2 uv){ vec3 c = texture2D(tSrc, uv).rgb; return min(c, vec3(24.0)); }
    void main(){
      vec3 c = (fetch(vUv + texel * vec2(-0.5, -0.5)) + fetch(vUv + texel * vec2(0.5, -0.5)) + fetch(vUv + texel * vec2(-0.5, 0.5)) + fetch(vUv + texel * vec2(0.5, 0.5))) * 0.25;
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + 1e-4);
      float contrib = max(soft, br - threshold) / max(br, 1e-4);
      gl_FragColor = vec4(c * contrib, 1.0);
    }`;

  const BLUR = `
    uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
      c += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;
      c += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`;

  const COMPOSITE = `
    uniform sampler2D tScene; uniform sampler2D tB0; uniform sampler2D tB1; uniform sampler2D tB2; uniform sampler2D tB3;
    uniform vec4 bloomW; uniform float exposure; uniform float vignette; uniform float hurt; uniform float lowHp;
    uniform float grain; uniform float time; uniform float aberration; uniform float sat; uniform float contrast; uniform vec3 tint;
    varying vec2 vUv;
    const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 ACES(vec3 c){ c *= exposure / 0.6; c = ACESInputMat * c; c = RRTAndODTFit(c); c = ACESOutputMat * c; return clamp(c, 0.0, 1.0); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 fromC = uv - 0.5;
      float r2 = dot(fromC, fromC);
      // chromatic aberration grows toward the edges (and when hurt)
      vec2 off = fromC * (aberration + hurt * 0.012) * (0.4 + r2 * 2.0);
      vec3 col;
      col.r = texture2D(tScene, uv + off).r;
      col.g = texture2D(tScene, uv).g;
      col.b = texture2D(tScene, uv - off).b;
      vec3 bloom = texture2D(tB0, uv).rgb * bloomW.x + texture2D(tB1, uv).rgb * bloomW.y + texture2D(tB2, uv).rgb * bloomW.z + texture2D(tB3, uv).rgb * bloomW.w;
      col += bloom;
      col = ACES(col);
      // grade: a touch of contrast, saturation, and a warm/cool tint
      col = (col - 0.5) * contrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat * (1.0 - lowHp * 0.7));
      col *= tint;
      col = toSRGB(clamp(col, 0.0, 1.0));
      float v = smoothstep(0.95, 0.25, r2 * 1.9);
      col *= mix(1.0, v, vignette);
      // blood at the edges
      float edge = smoothstep(0.08, 0.34, r2);
      col = mix(col, vec3(0.75, 0.02, 0.05), clamp(hurt * edge * 0.75 + lowHp * edge * (0.25 + 0.15 * sin(time * 6.0)), 0.0, 0.9));
      col += (hash(uv * 1000.0) - 0.5) * grain;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function create(renderer, opts) {
    opts = opts || {};
    const caps = renderer.capabilities;
    if (!caps.isWebGL2) return null;
    let floatOk = false;
    try {
      floatOk = !!(renderer.extensions.get('EXT_color_buffer_float') || renderer.extensions.get('EXT_color_buffer_half_float'));
    } catch (e) {
      floatOk = false;
    }
    if (!floatOk) return null;

    const levels = opts.mobile ? 3 : 4;
    const samples = Math.min(opts.mobile ? 2 : 4, caps.maxSamples || 0);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), null);
    quad.frustumCulled = false;
    const pass = new T.Scene();
    pass.add(quad);

    const mk = (frag, uniforms) => new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    const extractMat = mk(EXTRACT, { tSrc: { value: null }, texel: { value: new T.Vector2() }, threshold: { value: 1.05 }, knee: { value: 0.7 } });
    const blurMat = mk(BLUR, { tSrc: { value: null }, dir: { value: new T.Vector2() } });
    const black = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    const compMat = mk(COMPOSITE, {
      tScene: { value: null },
      tB0: { value: black },
      tB1: { value: black },
      tB2: { value: black },
      tB3: { value: black },
      bloomW: { value: new T.Vector4(0.55, 0.5, 0.45, 0.4) },
      exposure: { value: 0.98 },
      vignette: { value: 0.55 },
      hurt: { value: 0 },
      lowHp: { value: 0 },
      grain: { value: 0.028 },
      time: { value: 0 },
      aberration: { value: 0.0025 },
      sat: { value: 1.1 },
      contrast: { value: 1.06 },
      tint: { value: new T.Vector3(1.0, 1.0, 1.0) },
    });

    const rtOpts = { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false };
    let sceneRT = null;
    const mipA = [];
    const mipB = [];
    let W = 2;
    let H = 2;
    let bloomLevels = levels;

    function disposeRTs() {
      if (sceneRT) sceneRT.dispose();
      [...mipA, ...mipB].forEach((r) => r.dispose());
      mipA.length = 0;
      mipB.length = 0;
    }

    function setSize(w, h) {
      W = Math.max(2, Math.floor(w));
      H = Math.max(2, Math.floor(h));
      disposeRTs();
      sceneRT = new T.WebGLRenderTarget(W, H, { ...rtOpts, depthBuffer: true, samples });
      for (let i = 0; i < levels; i++) {
        const mw = Math.max(2, W >> (i + 1));
        const mh = Math.max(2, H >> (i + 1));
        mipA.push(new T.WebGLRenderTarget(mw, mh, rtOpts));
        mipB.push(new T.WebGLRenderTarget(mw, mh, rtOpts));
      }
    }

    function run(mat, target, uniforms) {
      quad.material = mat;
      Object.assign(mat.uniforms, uniforms);
      renderer.setRenderTarget(target);
      renderer.render(pass, cam);
    }

    const state = { hurt: 0, lowHp: 0, tint: [1, 1, 1], exposure: 0.98, bloom: 1, time: 0 };

    function render(scene, camera) {
      if (!sceneRT) return false;
      const prev = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.autoClear = false;
      // bright pass -> blur chain
      let src = sceneRT.texture;
      let srcW = W;
      let srcH = H;
      for (let i = 0; i < bloomLevels; i++) {
        const a = mipA[i];
        const b = mipB[i];
        if (i === 0) run(extractMat, a, { tSrc: { value: src }, texel: { value: new T.Vector2(1 / srcW, 1 / srcH) } });
        else run(extractMat, a, { tSrc: { value: src }, texel: { value: new T.Vector2(1 / srcW, 1 / srcH) }, threshold: { value: 0.0 }, knee: { value: 0.0001 } });
        run(blurMat, b, { tSrc: { value: a.texture }, dir: { value: new T.Vector2(1 / a.width, 0) } });
        run(blurMat, a, { tSrc: { value: b.texture }, dir: { value: new T.Vector2(0, 1 / a.height) } });
        src = a.texture;
        srcW = a.width;
        srcH = a.height;
      }
      extractMat.uniforms.threshold.value = 1.05;
      extractMat.uniforms.knee.value = 0.7;
      const u = compMat.uniforms;
      u.tScene.value = sceneRT.texture;
      u.tB0.value = bloomLevels > 0 ? mipA[0].texture : black;
      u.tB1.value = bloomLevels > 1 ? mipA[1].texture : black;
      u.tB2.value = bloomLevels > 2 ? mipA[2].texture : black;
      u.tB3.value = bloomLevels > 3 ? mipA[3].texture : black;
      const k = state.bloom;
      u.bloomW.value.set(0.5 * k, 0.5 * k, 0.45 * k, 0.4 * k);
      u.exposure.value = state.exposure;
      u.hurt.value = state.hurt;
      u.lowHp.value = state.lowHp;
      u.tint.value.set(state.tint[0], state.tint[1], state.tint[2]);
      u.time.value = state.time % 1000;
      quad.material = compMat;
      renderer.setRenderTarget(null);
      renderer.render(pass, cam);
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(prev);
      return true;
    }

    return {
      state,
      setSize,
      render,
      // 0 = full, 1 = fewer bloom levels, 2 = no bloom chain (still tone mapped)
      setQuality(q) {
        bloomLevels = q <= 0 ? levels : q === 1 ? Math.min(2, levels) : 0;
      },
      dispose: disposeRTs,
      uniforms: compMat.uniforms,
    };
  }

  return { create };
})();
