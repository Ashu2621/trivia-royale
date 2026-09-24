/*
 * CityWorld — the 3D environment for City Mission (Three.js).
 *
 * Builds everything that does not move: PBR-lit streets with markings and wear, sidewalks,
 * kind-specific buildings with lit windows and storefronts, parks with an animated fountain,
 * lamps, traffic lights, a distant skyline and a sky that shifts from morning to dusk.
 * Nothing here talks to the server; city3d.js feeds it the map and the time of day.
 */
const CityWorld = (function () {
  'use strict';

  const T = THREE;
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, x) => {
    const k = clamp((x - a) / (b - a), 0, 1);
    return k * k * (3 - 2 * k);
  };

  function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const cv = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w));
    c.height = Math.max(2, Math.round(h));
    return c;
  };

  function mixHex(a, b, k) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, k));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  /* ------------------------------------------------------------------ build */

  function build(scene, renderer, map, missions, q) {
    const R = rngFrom(20261030);
    const envMats = []; // materials that get brighter/dimmer with the sky
    const glow = { walls: [], lamps: [], signs: [], neon: [] }; // things that respond to night
    const animated = [];
    const doorGlows = [];
    const buildings = [];
    const root = new T.Group();
    scene.add(root);

    function tex(c, o) {
      o = o || {};
      const t = new T.CanvasTexture(c);
      if (!o.linear) t.encoding = T.sRGBEncoding;
      t.anisotropy = q.aniso;
      if (o.repeat) {
        t.wrapS = t.wrapT = T.RepeatWrapping;
        t.repeat.set(o.repeat[0], o.repeat[1]);
      }
      return t;
    }

    const matCache = new Map();
    function std(color, rough, metal, extra) {
      const key = extra ? null : `${color}|${rough}|${metal}`;
      if (key && matCache.has(key)) return matCache.get(key);
      const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: rough == null ? 0.85 : rough, metalness: metal || 0 }, extra));
      envMats.push(m);
      if (key) matCache.set(key, m);
      return m;
    }

    function mesh(geo, mat, x, y, z, parent, shadow) {
      const m = new T.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      if (shadow !== false) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      (parent || root).add(m);
      return m;
    }
    const box = (w, h, d, mat, x, y, z, parent) => mesh(new T.BoxGeometry(w, h, d), mat, x, y, z, parent);

    /* -------------------------------------------------------------- sky */

    const skyU = {
      top: { value: new T.Color('#4a90e2') },
      mid: { value: new T.Color('#b9dcf7') },
      bottom: { value: new T.Color('#5a5f66') },
      sunDir: { value: new T.Vector3(0, 1, 0) },
      sunColor: { value: new T.Color('#fff1d6') },
    };
    const skyVS = 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
    const skyFS = `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(mid, top, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(mid, bottom, clamp(-h * 6.0, 0.0, 1.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 16.0) * 0.28 + pow(s, 3.0) * 0.06);
        gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
      }`;
    const skyMat = new T.ShaderMaterial({ uniforms: skyU, vertexShader: skyVS, fragmentShader: skyFS, side: T.BackSide, depthWrite: false, fog: false });
    const sky = new T.Mesh(new T.SphereGeometry(5200, 24, 16), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    // a tiny copy of the sky lights every shiny surface (glass, car paint) via image-based lighting
    const envScene = new T.Scene();
    const envSky = new T.Mesh(new T.SphereGeometry(20, 24, 16), new T.ShaderMaterial({ uniforms: skyU, vertexShader: skyVS, fragmentShader: skyFS, side: T.BackSide, depthWrite: false, fog: false }));
    envScene.add(envSky);
    try {
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(envScene, 0.02, 1, 60).texture;
      pm.dispose();
    } catch (e) {
      scene.environment = null;
    }

    // distant skyline + hills, painted once on a cylinder that follows the camera
    const skylineC = cv(4096, 320);
    {
      const g = skylineC.getContext('2d');
      g.clearRect(0, 0, 4096, 320);
      const R2 = rngFrom(77);
      g.fillStyle = 'rgba(70,84,118,0.85)';
      g.beginPath();
      g.moveTo(0, 320);
      for (let x = 0; x <= 4096; x += 32) g.lineTo(x, 200 - Math.abs(Math.sin(x * 0.0031) * 70) - Math.abs(Math.sin(x * 0.0093 + 2) * 36));
      g.lineTo(4096, 320);
      g.fill();
      g.fillStyle = 'rgba(46,58,92,0.95)';
      let x = 0;
      while (x < 4096) {
        const w = 26 + R2() * 60;
        const h = 60 + R2() * 170 * (0.4 + 0.6 * Math.abs(Math.sin(x * 0.0021)));
        g.fillRect(x, 320 - h, w, h);
        g.fillStyle = 'rgba(255,224,150,0.5)';
        for (let wy = 320 - h + 8; wy < 314; wy += 12) for (let wx = x + 4; wx < x + w - 6; wx += 9) if (R2() < 0.32) g.fillRect(wx, wy, 3, 4);
        g.fillStyle = 'rgba(46,58,92,0.95)';
        x += w + 4 + R2() * 14;
      }
    }
    const skylineTex = tex(skylineC);
    skylineTex.wrapS = T.RepeatWrapping;
    const skylineMat = new T.MeshBasicMaterial({ map: skylineTex, transparent: true, side: T.BackSide, depthWrite: false, fog: false, color: 0xffffff });
    const skyline = new T.Mesh(new T.CylinderGeometry(4300, 4300, 640, 48, 1, true), skylineMat);
    skyline.position.y = 300;
    skyline.frustumCulled = false;
    skyline.renderOrder = -9;
    scene.add(skyline);

    // soft clouds
    const cloudC = cv(256, 128);
    {
      const g = cloudC.getContext('2d');
      const R3 = rngFrom(5);
      for (let i = 0; i < 22; i++) {
        const cx = 40 + R3() * 176;
        const cy = 54 + R3() * 26;
        const r = 18 + R3() * 26;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    const cloudTex = tex(cloudC);
    const clouds = [];
    const cloudGroup = new T.Group();
    for (let i = 0; i < 9; i++) {
      const m = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      const ang = (i / 9) * TAU + R() * 0.5;
      m.userData = { ang, rad: 2600 + R() * 1500, y: 700 + R() * 700, sp: 0.002 + R() * 0.004 };
      m.scale.set(1500 + R() * 900, 480 + R() * 260, 1);
      cloudGroup.add(m);
      clouds.push(m);
    }
    scene.add(cloudGroup);

    /* ----------------------------------------------------------- lighting */

    const hemi = new T.HemisphereLight(0xbcd8ff, 0x6a6350, 0.4);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const sc = sun.shadow.camera;
    sc.left = -560;
    sc.right = 560;
    sc.top = 560;
    sc.bottom = -560;
    sc.near = 10;
    sc.far = 2400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 1.4;
    scene.add(sun, sun.target);
    const fog = new T.Fog(0xcfe4f5, 900, 4300);
    scene.fog = fog;

    /* --------------------------------------------------- terrain + roads */

    // grass beyond the walls
    function grassCanvas(size, seed) {
      const c = cv(size, size);
      const g = c.getContext('2d');
      const r = rngFrom(seed);
      g.fillStyle = '#4f7d3c';
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < size * 5; i++) {
        const l = 30 + r() * 30;
        g.fillStyle = `hsla(${88 + r() * 30},${40 + r() * 25}%,${l}%,0.2)`;
        g.fillRect(r() * size, r() * size, 2 + r() * 9, 2 + r() * 9);
      }
      g.lineWidth = 1;
      for (let i = 0; i < size * 4; i++) {
        const x = r() * size;
        const y = r() * size;
        g.strokeStyle = `hsla(${80 + r() * 40},55%,${28 + r() * 32}%,0.5)`;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 6);
        g.stroke();
      }
      return c;
    }
    const outerTex = tex(grassCanvas(256, 11), { repeat: [90, 90] });
    const outer = new T.Mesh(new T.PlaneGeometry(9000, 9000), std(0xffffff, 1, 0, { map: outerTex }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(map.w / 2, -1.2, map.h / 2);
    outer.receiveShadow = true;
    root.add(outer);

    function roadCanvas(k) {
      const c = cv(map.w * k, map.h * k);
      const g = c.getContext('2d');
      const r = rngFrom(31337);
      g.scale(k, k);
      g.fillStyle = '#3a3d44';
      g.fillRect(0, 0, map.w, map.h);
      // mottled wear
      for (let i = 0; i < 1400; i++) {
        const v = 40 + Math.floor(r() * 26);
        g.fillStyle = `rgba(${v},${v},${v + 4},0.10)`;
        g.fillRect(r() * map.w, r() * map.h, 12 + r() * 90, 8 + r() * 46);
      }
      for (let i = 0; i < 26000; i++) {
        const light = r() < 0.5;
        g.fillStyle = light ? `rgba(200,200,205,${0.05 + r() * 0.1})` : `rgba(10,10,14,${0.1 + r() * 0.18})`;
        g.fillRect(r() * map.w, r() * map.h, 1 + r() * 1.4, 1 + r() * 1.4);
      }
      const xs = [];
      const ys = [];
      for (let i = 0; i < map.cols; i++) xs.push(i * map.colStep + 50);
      for (let j = 0; j < map.rows; j++) ys.push(j * map.rowStep + 50);
      // tyre wear along each lane, oil stains, patches
      g.fillStyle = 'rgba(8,8,10,0.18)';
      for (const x of xs) for (const off of [-27, -13, 13, 27]) g.fillRect(x + off - 3, 0, 6, map.h);
      for (const y of ys) for (const off of [-27, -13, 13, 27]) g.fillRect(0, y + off - 3, map.w, 6);
      for (let i = 0; i < 90; i++) {
        const gx = xs[Math.floor(r() * xs.length)] + (r() - 0.5) * 70;
        const gy = r() * map.h;
        g.fillStyle = `rgba(6,6,8,${0.12 + r() * 0.16})`;
        g.beginPath();
        g.ellipse(gx, gy, 3 + r() * 7, 2 + r() * 4, r() * 3, 0, TAU);
        g.fill();
      }
      for (let i = 0; i < 26; i++) {
        const px = r() * map.w;
        const py = r() * map.h;
        g.fillStyle = `rgba(${28 + r() * 14},${28 + r() * 14},${30 + r() * 14},0.65)`;
        g.fillRect(px, py, 18 + r() * 34, 10 + r() * 22);
      }
      // cracks
      g.strokeStyle = 'rgba(8,8,10,0.55)';
      g.lineWidth = 0.9;
      for (let i = 0; i < 70; i++) {
        let x = r() * map.w;
        let y = r() * map.h;
        g.beginPath();
        g.moveTo(x, y);
        for (let s = 0; s < 6; s++) {
          x += (r() - 0.5) * 20;
          y += (r() - 0.5) * 20;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      // markings between intersections
      const seg = (vals, max) => {
        const out = [[0, vals[0] - 64]];
        for (let i = 0; i < vals.length - 1; i++) out.push([vals[i] + 64, vals[i + 1] - 64]);
        out.push([vals[vals.length - 1] + 64, max]);
        return out;
      };
      const worn = (fn) => {
        fn();
      };
      for (const x of xs) {
        for (const [a, b] of seg(ys, map.h)) {
          worn(() => {
            g.fillStyle = 'rgba(232,190,50,0.9)';
            g.fillRect(x - 3.2, a, 1.6, b - a);
            g.fillRect(x + 1.6, a, 1.6, b - a);
            g.fillStyle = 'rgba(235,235,235,0.75)';
            g.fillRect(x - 42, a, 1.6, b - a);
            g.fillRect(x + 40.4, a, 1.6, b - a);
            g.fillStyle = 'rgba(235,235,235,0.6)';
            for (let yy = a + 4; yy < b - 12; yy += 36) {
              g.fillRect(x - 22, yy, 1.4, 16);
              g.fillRect(x + 20.6, yy, 1.4, 16);
            }
          });
        }
      }
      for (const y of ys) {
        for (const [a, b] of seg(xs, map.w)) {
          g.fillStyle = 'rgba(232,190,50,0.9)';
          g.fillRect(a, y - 3.2, b - a, 1.6);
          g.fillRect(a, y + 1.6, b - a, 1.6);
          g.fillStyle = 'rgba(235,235,235,0.75)';
          g.fillRect(a, y - 42, b - a, 1.6);
          g.fillRect(a, y + 40.4, b - a, 1.6);
          g.fillStyle = 'rgba(235,235,235,0.6)';
          for (let xx = a + 4; xx < b - 12; xx += 36) {
            g.fillRect(xx, y - 22, 16, 1.4);
            g.fillRect(xx, y + 20.6, 16, 1.4);
          }
        }
      }
      // intersections: darker patch, stop lines, zebra crossings
      for (const cx of xs) {
        for (const cy of ys) {
          g.fillStyle = 'rgba(12,12,16,0.22)';
          g.fillRect(cx - 44, cy - 44, 88, 88);
          g.fillStyle = 'rgba(240,240,240,0.85)';
          for (let n = -3; n <= 3; n++) {
            g.fillRect(cx + n * 12 - 3, cy - 68, 6, 18);
            g.fillRect(cx + n * 12 - 3, cy + 50, 6, 18);
            g.fillRect(cx - 68, cy + n * 12 - 3, 18, 6);
            g.fillRect(cx + 50, cy + n * 12 - 3, 18, 6);
          }
          g.fillRect(cx - 42, cy - 74, 40, 2.4);
          g.fillRect(cx + 2, cy + 72, 40, 2.4);
          g.fillRect(cx - 74, cy + 2, 2.4, 40);
          g.fillRect(cx + 72, cy - 42, 2.4, 40);
          // manhole
          g.fillStyle = 'rgba(20,20,24,0.8)';
          g.beginPath();
          g.arc(cx + 14, cy + 12, 6, 0, TAU);
          g.fill();
          g.strokeStyle = 'rgba(120,120,128,0.5)';
          g.lineWidth = 1;
          g.stroke();
        }
      }
      return c;
    }
    const roadTex = tex(roadCanvas(q.texScale));
    const ground = new T.Mesh(new T.PlaneGeometry(map.w, map.h), std(0xffffff, 0.9, 0, { map: roadTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(map.w / 2, 0, map.h / 2);
    ground.receiveShadow = true;
    root.add(ground);

    /* ------------------------------------------------------- sidewalks */

    function paveCanvas() {
      const c = cv(256, 256);
      const g = c.getContext('2d');
      const r = rngFrom(9);
      g.fillStyle = '#b7b9bd';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 4000; i++) {
        const v = 150 + Math.floor(r() * 70);
        g.fillStyle = `rgba(${v},${v},${v + 2},0.18)`;
        g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3);
      }
      g.strokeStyle = 'rgba(70,72,78,0.55)';
      g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo(i * 64, 0);
        g.lineTo(i * 64, 256);
        g.moveTo(0, i * 64);
        g.lineTo(256, i * 64);
        g.stroke();
      }
      for (let i = 0; i < 16; i++) {
        g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.06})`;
        g.fillRect(Math.floor(r() * 4) * 64 + 2, Math.floor(r() * 4) * 64 + 2, 60, 60);
      }
      return c;
    }
    const paveTop = tex(paveCanvas(), { repeat: [380 / 64, 260 / 64] });
    const curbMat = std(0x8c8f96, 0.9);
    const paveMats = [curbMat, curbMat, std(0xffffff, 0.92, 0, { map: paveTop }), curbMat, curbMat, curbMat];
    const parkC = (function () {
      const k = q.texScale >= 1.5 ? 2 : 1.4;
      const c = cv(340 * k, 220 * k);
      const g = c.getContext('2d');
      const r = rngFrom(404);
      g.scale(k, k);
      g.fillStyle = '#4c8a3e';
      g.fillRect(0, 0, 340, 220);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `hsla(${85 + r() * 35},${40 + r() * 30}%,${26 + r() * 30}%,0.32)`;
        g.fillRect(r() * 340, r() * 220, 1 + r() * 3, 1 + r() * 3);
      }
      // gravel paths + plaza
      g.fillStyle = '#c9b48a';
      g.fillRect(0, 100, 340, 20);
      g.fillRect(160, 0, 20, 220);
      g.beginPath();
      g.arc(170, 110, 58, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 700; i++) g.fillRect(r() * 340, r() * 220, 1.5, 1.5);
      g.strokeStyle = 'rgba(80,60,30,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(170, 110, 58, 0, TAU);
      g.stroke();
      // flower beds
      for (let i = 0; i < 90; i++) {
        const fx = 18 + r() * 304;
        const fy = 14 + r() * 192;
        if ((fx > 150 && fx < 190) || (fy > 92 && fy < 128)) continue;
        g.fillStyle = ['#ff6b81', '#ffd166', '#f8f8f8', '#b892ff', '#ff9f43'][Math.floor(r() * 5)];
        g.beginPath();
        g.arc(fx, fy, 1.6 + r() * 1.3, 0, TAU);
        g.fill();
      }
      return c;
    })();
    const parkTop = tex(parkC);
    const parkMats = [std(0x5c6b45, 1), std(0x5c6b45, 1), std(0xffffff, 1, 0, { map: parkTop }), std(0x444444, 1), std(0x5c6b45, 1), std(0x5c6b45, 1)];

    const lampPts = [];
    const blockRefs = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const x0 = c * map.colStep + 100;
        const y0 = r * map.rowStep + 100;
        box(392, 2, 272, curbMat, x0 + 190, 1, y0 + 130, root).receiveShadow = true;
        const top = new T.Mesh(new T.BoxGeometry(380, 1.6, 260), paveMats);
        top.position.set(x0 + 190, 2.8, y0 + 130);
        top.receiveShadow = true;
        root.add(top);
        blockRefs.push({ x0, y0 });
      }
    }
    const parkRefs = [];
    for (const p of map.parks) {
      const slab = new T.Mesh(new T.BoxGeometry(p.w, 2, p.h), parkMats);
      slab.position.set(p.x + p.w / 2, 4.4, p.y + p.h / 2);
      slab.receiveShadow = true;
      root.add(slab);
      parkRefs.push(p);
    }

    /* --------------------------------------------------------- borders */

    {
      const wallMat = std(0x9a9da4, 0.95);
      const capMat = std(0x6f727a, 0.9);
      const wl = (w, d, x, z) => {
        box(w, 12, d, wallMat, x, 6, z);
        box(w + 2, 2, d + 2, capMat, x, 13, z);
      };
      wl(map.w + 24, 10, map.w / 2, -5);
      wl(map.w + 24, 10, map.w / 2, map.h + 5);
      wl(10, map.h, -5, map.h / 2);
      wl(10, map.h, map.w + 5, map.h / 2);
    }

    /* -------------------------------------------------------- buildings */

    function wallTile(hex, seed) {
      const r = rngFrom(seed);
      const bays = 3;
      const floors = 4;
      const bw = 64;
      const fh = 72;
      const c = cv(bays * bw, floors * fh);
      const e = cv(c.width, c.height);
      const g = c.getContext('2d');
      const eg = e.getContext('2d');
      g.fillStyle = hex;
      g.fillRect(0, 0, c.width, c.height);
      const gr = g.createLinearGradient(0, 0, 0, c.height);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)');
      gr.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = gr;
      g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.06})`;
        g.fillRect(r() * c.width, r() * c.height, 2 + r() * 9, 2 + r() * 9);
      }
      eg.fillStyle = '#000';
      eg.fillRect(0, 0, e.width, e.height);
      for (let f = 0; f < floors; f++) {
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.fillRect(0, f * fh, c.width, 3);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(0, f * fh + 3, c.width, 2);
        for (let b = 0; b < bays; b++) {
          const x = b * bw + 11;
          const y = f * fh + 15;
          const w = bw - 22;
          const h = fh - 32;
          g.fillStyle = 'rgba(16,18,24,0.92)';
          g.fillRect(x - 2, y - 2, w + 4, h + 4);
          const gl = g.createLinearGradient(x, y, x + w, y + h);
          gl.addColorStop(0, '#a9d4f0');
          gl.addColorStop(0.45, '#4f82a8');
          gl.addColorStop(1, '#213f5a');
          g.fillStyle = gl;
          g.fillRect(x, y, w, h);
          g.fillStyle = 'rgba(255,255,255,0.22)';
          g.beginPath();
          g.moveTo(x, y + h * 0.5);
          g.lineTo(x + w * 0.5, y);
          g.lineTo(x + w * 0.75, y);
          g.lineTo(x, y + h * 0.8);
          g.fill();
          g.fillStyle = 'rgba(16,18,24,0.9)';
          g.fillRect(x + w / 2 - 1, y, 2, h);
          g.fillStyle = 'rgba(255,255,255,0.4)';
          g.fillRect(x - 3, y + h + 2, w + 6, 3);
          if (r() < 0.5) {
            eg.fillStyle = ['#ffd98a', '#ffe9b8', '#ffcf70', '#d6ecff'][Math.floor(r() * 4)];
            eg.fillRect(x, y, w, h);
            eg.fillStyle = 'rgba(0,0,0,0.5)';
            eg.fillRect(x + w / 2 - 1, y, 2, h);
          }
        }
      }
      return { c, e };
    }

    function storefront(b, seed) {
      const r = rngFrom(seed);
      const w = b.w * 2;
      const h = 84;
      const c = cv(w, h);
      const e = cv(w, h);
      const g = c.getContext('2d');
      const eg = e.getContext('2d');
      g.fillStyle = '#23262d';
      g.fillRect(0, 0, w, h);
      eg.fillStyle = '#000';
      eg.fillRect(0, 0, w, h);
      const panes = 6;
      const pw = w / panes;
      for (let i = 0; i < panes; i++) {
        const x = i * pw + 10;
        const ww = pw - 20;
        if (Math.abs(x + ww / 2 - w / 2) < 60) continue; // the door
        const gl = g.createLinearGradient(x, 8, x + ww, h);
        gl.addColorStop(0, '#7fb0cf');
        gl.addColorStop(1, '#1d3446');
        g.fillStyle = gl;
        g.fillRect(x, 8, ww, h - 14);
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.fillRect(x + 6, 8, 10, h - 14);
        eg.fillStyle = `rgba(255,214,140,${0.55 + r() * 0.3})`;
        eg.fillRect(x, 8, ww, h - 14);
        eg.fillStyle = 'rgba(0,0,0,0.55)';
        for (let s = 0; s < 3; s++) eg.fillRect(x + 8 + r() * (ww - 30), 34 + r() * 30, 12 + r() * 16, 22);
      }
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(0, 0, w, 4);
      // door recess
      g.fillStyle = '#0d0f14';
      g.fillRect(w / 2 - 36, 12, 72, h - 12);
      g.fillStyle = 'rgba(160,200,225,0.35)';
      g.fillRect(w / 2 - 32, 16, 30, h - 20);
      g.fillRect(w / 2 + 2, 16, 30, h - 20);
      eg.fillStyle = 'rgba(255,220,150,0.55)';
      eg.fillRect(w / 2 - 32, 16, 30, h - 20);
      eg.fillRect(w / 2 + 2, 16, 30, h - 20);
      return { c, e };
    }

    function roofTile() {
      const c = cv(128, 128);
      const g = c.getContext('2d');
      const r = rngFrom(66);
      g.fillStyle = '#5b5e66';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1800; i++) {
        const v = 70 + Math.floor(r() * 60);
        g.fillStyle = `rgba(${v},${v},${v},0.3)`;
        g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 2);
      }
      g.strokeStyle = 'rgba(20,20,24,0.35)';
      g.strokeRect(1, 1, 126, 126);
      return c;
    }
    const roofTex = tex(roofTile(), { repeat: [300 / 64, 180 / 64] });

    function signTexture(b) {
      const c = cv(640, 110);
      const g = c.getContext('2d');
      g.fillStyle = '#0c1024';
      const rr = (x, y, w, h, rad) => {
        g.beginPath();
        g.moveTo(x + rad, y);
        g.arcTo(x + w, y, x + w, y + h, rad);
        g.arcTo(x + w, y + h, x, y + h, rad);
        g.arcTo(x, y + h, x, y, rad);
        g.arcTo(x, y, x + w, y, rad);
        g.closePath();
      };
      rr(4, 4, 632, 102, 22);
      g.fill();
      g.strokeStyle = b.color;
      g.lineWidth = 8;
      rr(8, 8, 624, 94, 20);
      g.stroke();
      g.shadowColor = b.color;
      g.shadowBlur = 16;
      g.fillStyle = '#ffffff';
      g.font = '800 54px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${b.icon} ${b.name.toUpperCase()}`, 320, 58);
      return c;
    }

    function roofDecal(b) {
      const c = cv(256, 256);
      const g = c.getContext('2d');
      g.clearRect(0, 0, 256, 256);
      if (b.kind === 'hospital') {
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.beginPath();
        g.arc(128, 128, 118, 0, TAU);
        g.fill();
        g.strokeStyle = '#e63946';
        g.lineWidth = 10;
        g.stroke();
        g.fillStyle = '#e63946';
        g.font = '900 150px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('H', 128, 138);
      } else {
        g.fillStyle = 'rgba(10,12,28,0.35)';
        g.beginPath();
        g.arc(128, 128, 112, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 6;
        g.stroke();
        g.font = '130px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b.icon, 128, 138);
      }
      return c;
    }

    const FLOORS = { gun: 4, garage: 3, arcade: 4, museum: 4, radio: 5, police: 5, diner: 2, airport: 4, bank: 6, hospital: 7 };
    const CONCRETE = '#c9c3b6';
    const acMat = std(0x9aa0a8, 0.6, 0.4);
    const darkMetal = std(0x2b2f37, 0.5, 0.6);
    const white = std(0xf1f1f1, 0.7);

    function roofProps(g, b, W, D, top) {
      const R4 = rngFrom(b.x * 7 + b.y);
      // parapet
      const par = std(0x777b84, 0.9);
      box(W, 4, 4, par, 0, top + 2, D / 2 - 2, g);
      box(W, 4, 4, par, 0, top + 2, -D / 2 + 2, g);
      box(4, 4, D - 8, par, W / 2 - 2, top + 2, 0, g);
      box(4, 4, D - 8, par, -W / 2 + 2, top + 2, 0, g);
      // air conditioners + vents
      for (let i = 0; i < 3; i++) {
        const ax = (R4() - 0.5) * (W - 90);
        const az = (R4() - 0.5) * (D - 70);
        box(26, 12, 22, acMat, ax, top + 6, az, g);
        const fan = mesh(new T.CylinderGeometry(7, 7, 2, 14), darkMetal, ax, top + 13, az, g);
        animated.push((t) => (fan.rotation.y = t * 6 + i));
      }
      const tank = mesh(new T.CylinderGeometry(9, 9, 22, 14), std(0x8a5a3a, 0.8), W / 2 - 34, top + 22, -D / 2 + 34, g);
      mesh(new T.ConeGeometry(10, 8, 14), std(0x6e442a, 0.8), W / 2 - 34, top + 37, -D / 2 + 34, g);
      tank.castShadow = true;
      for (const lx of [-8, 8]) box(2, 14, 2, darkMetal, W / 2 - 34 + lx, top + 7, -D / 2 + 34, g);
      // roof marking
      const decal = new T.Mesh(new T.PlaneGeometry(112, 112), new T.MeshBasicMaterial({ map: tex(roofDecal(b)), transparent: true, depthWrite: false, toneMapped: false }));
      decal.rotation.x = -Math.PI / 2;
      decal.position.set(-W / 6, top + 4.4, 6);
      g.add(decal);

      if (b.kind === 'police') {
        const barMat = std(0x222222, 0.5);
        box(46, 5, 9, barMat, 0, top + 7, D / 2 - 18, g);
        const red = new T.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 3 });
        const blue = new T.MeshStandardMaterial({ color: 0x000022, emissive: 0x2a5cff, emissiveIntensity: 3 });
        box(20, 6, 8, red, -12, top + 10, D / 2 - 18, g);
        box(20, 6, 8, blue, 12, top + 10, D / 2 - 18, g);
        animated.push((t) => {
          const k = Math.floor(t * 4) % 2;
          red.emissiveIntensity = k ? 3.6 : 0.2;
          blue.emissiveIntensity = k ? 0.2 : 3.6;
        });
      } else if (b.kind === 'radio') {
        mesh(new T.CylinderGeometry(1.4, 3.4, 130, 8), darkMetal, W / 2 - 40, top + 65, 10, g);
        for (let s = 0; s < 4; s++) box(20 - s * 4, 1.5, 1.5, darkMetal, W / 2 - 40, top + 30 + s * 24, 10, g);
        const blink = new T.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2222, emissiveIntensity: 3 });
        mesh(new T.SphereGeometry(3.4, 10, 8), blink, W / 2 - 40, top + 132, 10, g, false);
        animated.push((t) => (blink.emissiveIntensity = Math.sin(t * 5) > 0 ? 4 : 0.2));
      } else if (b.kind === 'airport') {
        mesh(new T.CylinderGeometry(9, 12, 84, 14), std(0xd7d9de, 0.7), -W / 2 + 40, top + 42, 0, g);
        mesh(new T.CylinderGeometry(20, 14, 16, 14), std(0x1a2c3d, 0.15, 0.7), -W / 2 + 40, top + 90, 0, g);
        mesh(new T.CylinderGeometry(22, 22, 3, 14), std(0xd7d9de, 0.6), -W / 2 + 40, top + 100, 0, g);
        const dish = new T.Group();
        dish.position.set(W / 2 - 60, top + 8, 10);
        g.add(dish);
        box(2, 14, 2, darkMetal, 0, 0, 0, dish);
        const arm = new T.Group();
        arm.position.y = 10;
        dish.add(arm);
        box(38, 3, 2, std(0xeeeeee, 0.6), 0, 0, 0, arm);
        animated.push((t) => (arm.rotation.y = t * 1.6));
      } else if (b.kind === 'diner') {
        const neon = new T.MeshStandardMaterial({ color: 0x220008, emissive: 0xff3355, emissiveIntensity: 2.5 });
        glow.neon.push(neon);
        box(W - 10, 2.4, 2.4, neon, 0, top + 6, D / 2 - 4, g);
        mesh(new T.CylinderGeometry(1.6, 1.6, 80, 8), darkMetal, W / 2 - 26, top + 40, D / 2 - 30, g);
        const bs = new T.Mesh(new T.PlaneGeometry(50, 50), new T.MeshBasicMaterial({ map: tex((() => { const c = cv(128, 128); const gx = c.getContext('2d'); gx.font = '96px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText('🍔', 64, 70); return c; })()), transparent: true, side: T.DoubleSide, toneMapped: false }));
        bs.position.set(W / 2 - 26, top + 90, D / 2 - 30);
        g.add(bs);
        animated.push((t) => (bs.rotation.y = Math.sin(t * 0.8) * 0.9));
      } else if (b.kind === 'arcade') {
        const n1 = new T.MeshStandardMaterial({ color: 0x110022, emissive: 0xc04dff, emissiveIntensity: 2.6 });
        const n2 = new T.MeshStandardMaterial({ color: 0x001a22, emissive: 0x2ee6ff, emissiveIntensity: 2.6 });
        glow.neon.push(n1, n2);
        box(W - 6, 2.4, 2.4, n1, 0, top + 7, D / 2 - 3, g);
        box(W - 6, 2.4, 2.4, n2, 0, top + 12, D / 2 - 3, g);
        animated.push((t) => {
          n1.emissiveIntensity = 2 + Math.sin(t * 3) * 1;
          n2.emissiveIntensity = 2 + Math.sin(t * 3 + 2) * 1;
        });
      } else if (b.kind === 'hospital') {
        const cross = new T.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2b3d, emissiveIntensity: 2.2 });
        glow.neon.push(cross);
        box(8, 30, 6, cross, W / 2 - 30, top + 26, D / 2 - 6, g);
        box(30, 8, 6, cross, W / 2 - 30, top + 26, D / 2 - 6, g);
      }
    }

    function frontProps(g, b, W, D, base) {
      const zf = D / 2 + 2; // front plane of the ground floor
      const kc = b.color;
      const col = std(mixHex(kc, '#ffffff', 0.55), 0.7);
      if (b.kind === 'bank' || b.kind === 'museum') {
        const colGeo = new T.CylinderGeometry(6, 6.6, base + 30, 14);
        for (let i = 0; i < 6; i++) {
          const cx = -W / 2 + 34 + i * ((W - 68) / 5);
          mesh(colGeo, white, cx, (base + 30) / 2, zf + 14, g);
          box(15, 3, 15, white, cx, 1.5, zf + 14, g);
          box(15, 3, 15, white, cx, base + 30 - 1.5, zf + 14, g);
        }
        box(W - 24, 8, 22, white, 0, base + 34, zf + 12, g);
        box(W - 10, 6, 40, std(0xb9b3a4, 0.9), 0, 3, zf + 24, g); // steps
        if (b.kind === 'museum') {
          const sh = new T.Shape();
          sh.moveTo(-(W - 24) / 2, 0);
          sh.lineTo((W - 24) / 2, 0);
          sh.lineTo(0, 24);
          sh.closePath();
          const ped = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: 20, bevelEnabled: false }), white);
          ped.position.set(0, base + 38, zf + 2);
          ped.castShadow = true;
          g.add(ped);
        }
      } else if (b.kind === 'gun') {
        const sand = std(0xa08558, 1);
        for (let side = -1; side <= 1; side += 2) {
          for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) box(15, 8, 10, sand, side * (78 + i * 16 + row * 8), 4 + row * 8, zf + 16, g);
        }
        const red = new T.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3b30, emissiveIntensity: 2.4 });
        glow.neon.push(red);
        mesh(new T.TorusGeometry(10, 1.2, 8, 24), red, -W / 2 + 26, base + 28, zf + 1, g, false);
        box(24, 1.2, 1.2, red, -W / 2 + 26, base + 28, zf + 1, g);
        box(1.2, 24, 1.2, red, -W / 2 + 26, base + 28, zf + 1, g);
      } else if (b.kind === 'garage') {
        const tyre = std(0x161616, 0.9);
        for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 4; i++) {
          const t = mesh(new T.TorusGeometry(7, 3.4, 8, 16), tyre, side * 96, 3.4 + i * 6.6, zf + 14, g);
          t.rotation.x = Math.PI / 2;
        }
        box(2, 26, 2, darkMetal, W / 2 - 24, 13, zf + 8, g);
        box(30, 3, 2, std(0xffb703, 0.5), W / 2 - 24, 27, zf + 8, g);
      } else if (b.kind === 'hospital') {
        const amb = std(0xf5f5f5, 0.5, 0.2);
        box(34, 14, 16, amb, W / 2 - 40, 9, zf + 26, g);
        box(16, 12, 14, amb, W / 2 - 24 + 6, 12, zf + 26, g);
        box(34, 3, 16.4, std(0xe63946, 0.6), W / 2 - 40, 9, zf + 26, g);
      } else if (b.kind === 'police') {
        for (let side = -1; side <= 1; side += 2) mesh(new T.CylinderGeometry(3, 3, 18, 10), std(0x2f6ff0, 0.5), side * 88, 9, zf + 16, g);
      } else if (b.kind === 'diner' || b.kind === 'arcade' || b.kind === 'radio') {
        for (let side = -1; side <= 1; side += 2) {
          box(20, 9, 20, std(0x6b6f78, 0.9), side * 96, 4.5, zf + 14, g);
          const bush = mesh(new T.IcosahedronGeometry(11, 1), std(0x2f7d3a, 1), side * 96, 17, zf + 14, g);
          bush.scale.y = 0.85;
        }
      }
      // awning above the door
      const awn = box(78, 4, 20, std(mixHex(kc, '#000000', 0.15), 0.7), 0, base - 4, zf + 10, g);
      awn.rotation.x = 0.16;
    }

    const doorGeo = new T.PlaneGeometry(36, 30);
    for (let i = 0; i < map.buildings.length; i++) {
      const b = map.buildings[i];
      const floors = FLOORS[b.kind] || 4;
      const W = b.w;
      const D = b.h;
      const base = 40;
      const H = floors * 36;
      const top = base + H;
      const g = new T.Group();
      g.position.set(b.x + W / 2, 0, b.y + D / 2);
      root.add(g);
      const wallHex = mixHex(b.color, CONCRETE, 0.62);
      const wt = wallTile(wallHex, 100 + i * 13);
      const mkFace = (repX) => {
        const a = tex(wt.c, { repeat: [repX, floors / 4] });
        const e = tex(wt.e, { repeat: [repX, floors / 4] });
        const m = new T.MeshStandardMaterial({ map: a, emissiveMap: e, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.55, metalness: 0.15 });
        envMats.push(m);
        glow.walls.push(m);
        return m;
      };
      const mFront = mkFace(W / 100);
      const mSide = mkFace(D / 90);
      const roofMat = std(0xffffff, 0.95, 0, { map: roofTex.clone() });
      roofMat.map.needsUpdate = true;
      const wallBox = new T.Mesh(new T.BoxGeometry(W - 4, H, D - 4), [mSide, mSide, roofMat, roofMat, mFront, mFront]);
      wallBox.position.y = base + H / 2;
      wallBox.castShadow = true;
      wallBox.receiveShadow = true;
      g.add(wallBox);
      // ground floor: storefront on the front, plinth elsewhere
      const sf = storefront(b, 300 + i);
      const sfMat = new T.MeshStandardMaterial({ map: tex(sf.c), emissiveMap: tex(sf.e), emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.3 });
      envMats.push(sfMat);
      glow.walls.push(sfMat);
      const plinth = std(mixHex(b.color, '#000000', 0.35), 0.8);
      const baseBox = new T.Mesh(new T.BoxGeometry(W, base, D), [plinth, plinth, plinth, plinth, sfMat, plinth]);
      baseBox.position.y = base / 2;
      baseBox.castShadow = true;
      baseBox.receiveShadow = true;
      g.add(baseBox);
      box(W + 6, 3, D + 6, std(0x6f727a, 0.85), 0, base + 1.5, 0, g);
      // corner pilasters
      for (const sx of [-1, 1]) box(6, H, 6, std(mixHex(b.color, '#ffffff', 0.25), 0.7), sx * (W / 2 - 3), base + H / 2, D / 2 - 3, g);
      // sign
      const signMat = new T.MeshBasicMaterial({ map: tex(signTexture(b)), toneMapped: false });
      glow.signs.push(signMat);
      const sign = new T.Mesh(new T.PlaneGeometry(208, 36), signMat);
      sign.position.set(0, base + 26, D / 2 + 1.6);
      g.add(sign);
      box(212, 40, 3, darkMetal, 0, base + 26, D / 2 - 0.4, g);
      // the door highlight (pulses when this is your target)
      const dMat = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const dGlow = new T.Mesh(doorGeo, dMat);
      dGlow.position.set(0, 16, D / 2 + 2.2);
      g.add(dGlow);
      doorGlows.push({ b, mat: dMat });

      roofProps(g, b, W, D, top);
      frontProps(g, b, W, D, base);

      const mats = new Set();
      g.traverse((o) => {
        if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      });
      const list = Array.from(mats).filter((m) => m !== dMat);
      buildings.push({
        b,
        group: g,
        mats: list,
        opacity: 1,
        aabb: { x0: b.x, x1: b.x + W, z0: b.y, z1: b.y + D, top: top + 30 },
        signMat,
      });
    }

    /* ---------------------------------------------- street furniture */

    const xs = [];
    const ys = [];
    for (let i = 0; i < map.cols; i++) xs.push(i * map.colStep + 50);
    for (let j = 0; j < map.rows; j++) ys.push(j * map.rowStep + 50);
    const nearIntersection = (v, arr) => arr.some((a) => Math.abs(v - a) < 84);

    const lamp = [];
    for (const x of xs) {
      for (let y = 30; y < map.h - 20; y += 150) {
        if (nearIntersection(y, ys)) continue;
        lamp.push({ x: x + (Math.floor(y / 150) % 2 ? 46 : -46), z: y, rot: Math.floor(y / 150) % 2 ? Math.PI : 0 });
      }
    }
    for (const y of ys) {
      for (let x = 30; x < map.w - 20; x += 150) {
        if (nearIntersection(x, xs)) continue;
        lamp.push({ x, z: y + (Math.floor(x / 150) % 2 ? 46 : -46), rot: Math.floor(x / 150) % 2 ? -Math.PI / 2 : Math.PI / 2 });
      }
    }
    {
      const poleG = new T.CylinderGeometry(1.5, 2.1, 66, 8);
      const armG = new T.BoxGeometry(22, 1.6, 2.4);
      const headG = new T.BoxGeometry(10, 2.4, 5);
      const poleI = new T.InstancedMesh(poleG, darkMetal, lamp.length);
      const armI = new T.InstancedMesh(armG, darkMetal, lamp.length);
      const lampMat = new T.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2a8, emissiveIntensity: 0.1 });
      glow.lamps.push(lampMat);
      const headI = new T.InstancedMesh(headG, lampMat, lamp.length);
      poleI.castShadow = armI.castShadow = true;
      const m = new T.Matrix4();
      const gl = [];
      lamp.forEach((l, i) => {
        m.makeTranslation(l.x, 33, l.z);
        poleI.setMatrixAt(i, m);
        const yaw = new T.Matrix4().makeRotationY(l.rot);
        const off = new T.Vector3(-10, 0, 0).applyMatrix4(yaw);
        m.makeRotationY(l.rot).setPosition(l.x + off.x, 65.5, l.z + off.z);
        armI.setMatrixAt(i, m);
        const off2 = new T.Vector3(-19, 0, 0).applyMatrix4(yaw);
        m.makeRotationY(l.rot).setPosition(l.x + off2.x, 64, l.z + off2.z);
        headI.setMatrixAt(i, m);
        gl.push(l.x + off2.x, 60, l.z + off2.z);
      });
      root.add(poleI, armI, headI);
      const glowTex = (() => {
        const c = cv(64, 64);
        const g2 = c.getContext('2d');
        const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,236,180,1)');
        gr.addColorStop(0.3, 'rgba(255,214,140,0.45)');
        gr.addColorStop(1, 'rgba(255,200,120,0)');
        g2.fillStyle = gr;
        g2.fillRect(0, 0, 64, 64);
        return tex(c);
      })();
      const pg = new T.BufferGeometry();
      pg.setAttribute('position', new T.Float32BufferAttribute(gl, 3));
      const pm = new T.PointsMaterial({ map: glowTex, size: 62, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true, fog: true });
      const pts = new T.Points(pg, pm);
      pts.frustumCulled = false;
      root.add(pts);
      glow.lampGlow = pm;
    }

    // traffic lights on opposite corners of each junction
    {
      const spots = [];
      for (const cx of xs) for (const cy of ys) {
        spots.push({ x: cx + 46, z: cy + 46, green: true });
        spots.push({ x: cx - 46, z: cy - 46, green: true });
        spots.push({ x: cx - 46, z: cy + 46, green: false });
        spots.push({ x: cx + 46, z: cy - 46, green: false });
      }
      const poleI = new T.InstancedMesh(new T.CylinderGeometry(1.3, 1.6, 46, 8), darkMetal, spots.length);
      const housI = new T.InstancedMesh(new T.BoxGeometry(6, 16, 5), std(0x15171c, 0.6), spots.length);
      const gm = new T.MeshStandardMaterial({ color: 0x002200, emissive: 0x18ff6a, emissiveIntensity: 2.4 });
      const rm = new T.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a2a, emissiveIntensity: 2.4 });
      const greens = spots.filter((s) => s.green);
      const reds = spots.filter((s) => !s.green);
      const gI = new T.InstancedMesh(new T.SphereGeometry(2, 8, 6), gm, greens.length);
      const rI = new T.InstancedMesh(new T.SphereGeometry(2, 8, 6), rm, reds.length);
      const m = new T.Matrix4();
      spots.forEach((s, i) => {
        m.makeTranslation(s.x, 23, s.z);
        poleI.setMatrixAt(i, m);
        m.makeTranslation(s.x, 50, s.z);
        housI.setMatrixAt(i, m);
      });
      greens.forEach((s, i) => {
        m.makeTranslation(s.x, 44.5, s.z + 3);
        gI.setMatrixAt(i, m);
      });
      reds.forEach((s, i) => {
        m.makeTranslation(s.x, 55.5, s.z + 3);
        rI.setMatrixAt(i, m);
      });
      poleI.castShadow = true;
      root.add(poleI, housI, gI, rI);
    }

    /* ------------------------------------------------ trees + fountain */

    {
      // park trees plus a forest belt outside the walls
      const RF = rngFrom(808);
      const trees = map.trees.map((tr) => [tr[0], tr[1], 1, 5]);
      const forestCount = q.mobile ? 170 : 300;
      for (let i = 0; i < forestCount; i++) {
        let x;
        let z;
        do {
          x = -900 + RF() * (map.w + 1800);
          z = -900 + RF() * (map.h + 1800);
        } while (x > -70 && x < map.w + 70 && z > -70 && z < map.h + 70);
        trees.push([Math.round(x), Math.round(z), 1.3 + RF() * 1.2, -1]);
      }
      const trunkI = new T.InstancedMesh(new T.CylinderGeometry(2.4, 3.6, 30, 7), std(0x5a3d22, 1), trees.length);
      const leafGeo = new T.IcosahedronGeometry(1, 1);
      const leafMat = std(0xffffff, 0.9, 0, { flatShading: true });
      const layers = [
        { r: 19, y: 34 },
        { r: 15, y: 50 },
        { r: 10, y: 63 },
      ];
      const leafI = layers.map(() => new T.InstancedMesh(leafGeo, leafMat, trees.length));
      const m = new T.Matrix4();
      const col = new T.Color();
      const q2 = new T.Quaternion();
      trees.forEach((tr, i) => {
        const s = (0.85 + R() * 0.5) * tr[2];
        const by = tr[3];
        m.compose(new T.Vector3(tr[0], 15 * s + by, tr[1]), q2, new T.Vector3(s, s, s));
        trunkI.setMatrixAt(i, m);
        const hue = 0.24 + R() * 0.09;
        layers.forEach((L, li) => {
          const r = L.r * s * (0.9 + R() * 0.2);
          m.compose(new T.Vector3(tr[0] + (R() - 0.5) * 4, L.y * s + by, tr[1] + (R() - 0.5) * 4), q2, new T.Vector3(r, r * 0.9, r));
          leafI[li].setMatrixAt(i, m);
          col.setHSL(hue, 0.6, 0.15 + li * 0.045 + R() * 0.05);
          leafI[li].setColorAt(i, col);
        });
      });
      trunkI.castShadow = true;
      root.add(trunkI);
      leafI.forEach((l) => {
        l.castShadow = true;
        l.receiveShadow = true;
        root.add(l);
      });
      // rolling hills on the horizon
      const hillI = new T.InstancedMesh(new T.IcosahedronGeometry(1, 2), std(0xffffff, 1, 0, { flatShading: true }), 26);
      for (let i = 0; i < 26; i++) {
        const ang = (i / 26) * TAU + RF() * 0.2;
        const dist = 1900 + RF() * 900;
        const r = 380 + RF() * 380;
        m.compose(new T.Vector3(map.w / 2 + Math.cos(ang) * dist * 1.25, -r * 0.55, map.h / 2 + Math.sin(ang) * dist), q2, new T.Vector3(r * 1.4, r, r * 1.4));
        hillI.setMatrixAt(i, m);
        col.setHSL(0.27 + RF() * 0.06, 0.32, 0.3 + RF() * 0.1);
        hillI.setColorAt(i, col);
      }
      root.add(hillI);
    }

    const fountains = [];
    for (const p of map.parks) {
      const cx = p.x + p.w / 2;
      const cz = p.y + p.h / 2;
      const grp = new T.Group();
      grp.position.set(cx, 5.4, cz);
      root.add(grp);
      const stone = std(0x9aa3ad, 0.7, 0.05);
      mesh(new T.CylinderGeometry(34, 36, 9, 32), stone, 0, 4.5, 0, grp);
      mesh(new T.TorusGeometry(34, 2.6, 8, 32), std(0xb9c1c9, 0.6), 0, 9, 0, grp).rotation.x = Math.PI / 2;
      const water = new T.Mesh(new T.CylinderGeometry(31, 31, 1, 32), new T.MeshStandardMaterial({ color: 0x3aa5e8, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.88 }));
      water.position.y = 8.4;
      grp.add(water);
      mesh(new T.CylinderGeometry(4, 6, 24, 12), stone, 0, 16, 0, grp);
      mesh(new T.CylinderGeometry(11, 5, 3, 16), stone, 0, 26, 0, grp);
      const N = 160;
      const pos = new Float32Array(N * 3);
      const vel = [];
      for (let i = 0; i < N; i++) vel.push({ a: R() * TAU, s: 8 + R() * 16, v: 40 + R() * 40, t: R() * 2 });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const spray = new T.Points(geo, new T.PointsMaterial({ color: 0xcfeeff, size: 2.4, transparent: true, opacity: 0.85, depthWrite: false }));
      spray.frustumCulled = false;
      grp.add(spray);
      fountains.push({ pos, vel, geo, water });
      // benches and hedges around the plaza
      const wood = std(0x7b5231, 0.85);
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * TAU + Math.PI / 4;
        const bx = Math.cos(ang) * 76;
        const bz = Math.sin(ang) * 76;
        const bench = new T.Group();
        bench.position.set(bx, 0, bz);
        bench.rotation.y = -ang + Math.PI / 2;
        grp.add(bench);
        box(20, 2, 7, wood, 0, 6, 0, bench);
        box(20, 6, 1.6, wood, 0, 10, -3, bench);
        box(2, 6, 6, darkMetal, -8, 3, 0, bench);
        box(2, 6, 6, darkMetal, 8, 3, 0, bench);
      }
      const hedge = std(0x2c7a38, 1);
      for (const [hx, hz, hw, hd] of [[-p.w / 2 + 12, 0, 6, p.h - 40], [p.w / 2 - 12, 0, 6, p.h - 40]]) box(hw, 8, hd, hedge, hx, 4, hz, grp);
    }

    /* ------------------------------------------------------- time of day */

    const KEYS = [
      { p: 0, top: '#3f86e0', mid: '#a9d3f7', fog: '#c6e0f4', sun: '#fff1d6', el: 0.95, si: 2.7, hi: 0.4, env: 0.9, night: 0 },
      { p: 0.6, top: '#4a80d0', mid: '#f0d8b4', fog: '#e6d2b4', sun: '#ffd9a0', el: 0.5, si: 2.5, hi: 0.38, env: 0.85, night: 0 },
      { p: 1, top: '#25336e', mid: '#ef8a5b', fog: '#b8806c', sun: '#ff8a4a', el: 0.16, si: 1.5, hi: 0.3, env: 0.5, night: 1 },
    ];
    const cA = new T.Color();
    const cB = new T.Color();
    const mixC = (out, a, b, k) => out.set(a).lerp(cB.set(b), k);
    const sunVec = new T.Vector3();
    let night = 0;
    let lastEnv = -1;

    function setTime(p) {
      p = clamp(p, 0, 1);
      let i = 0;
      while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
      const a = KEYS[i];
      const b = KEYS[i + 1];
      const k = clamp((p - a.p) / (b.p - a.p), 0, 1);
      mixC(skyU.top.value, a.top, b.top, k);
      mixC(skyU.mid.value, a.mid, b.mid, k);
      mixC(skyU.sunColor.value, a.sun, b.sun, k);
      skyU.bottom.value.set('#4b4e55').lerp(cB.set('#2a2b30'), p);
      mixC(fog.color, a.fog, b.fog, k);
      sun.color.copy(skyU.sunColor.value);
      sun.intensity = lerp(a.si, b.si, k);
      hemi.intensity = lerp(a.hi, b.hi, k);
      const el = lerp(a.el, b.el, k);
      const az = -0.75 + p * 1.5;
      sunVec.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      skyU.sunDir.value.copy(sunVec);
      night = smooth(0.62, 1, p);
      const env = lerp(a.env, b.env, k);
      if (Math.abs(env - lastEnv) > 0.02) {
        lastEnv = env;
        envMats.forEach((m) => (m.envMapIntensity = env));
      }
      skylineMat.color.set('#ffffff').lerp(cB.set('#8a86a8'), night * 0.7);
      const wallGlow = 0.1 + night * 1.15;
      glow.walls.forEach((m) => (m.emissiveIntensity = m === glow.walls[0] ? wallGlow : wallGlow));
      glow.lamps.forEach((m) => (m.emissiveIntensity = 0.15 + night * 3.2));
      if (glow.lampGlow) glow.lampGlow.opacity = night * 0.95;
      glow.neon.forEach((m) => (m.userData.base = m.userData.base || m.emissiveIntensity));
      return night;
    }

    /* -------------------------------------------------------------- update */

    const tmpDir = new T.Vector3();
    function update(t, dt, focus, camPos, targetDoorIdx) {
      // sun + shadow box follow the player, snapped to shadow texels to avoid shimmering
      const texel = (sc.right - sc.left) / q.shadowSize;
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx + sunVec.x * 1200, sunVec.y * 1200, fz + sunVec.z * 1200);
      sun.target.updateMatrixWorld();
      // sky dome, skyline and clouds ride along with the camera
      sky.position.copy(camPos);
      skyline.position.set(camPos.x, 300, camPos.z);
      cloudGroup.position.set(camPos.x, 0, camPos.z);
      for (const c of clouds) {
        const u = c.userData;
        const a = u.ang + t * u.sp;
        c.position.set(Math.cos(a) * u.rad, u.y, Math.sin(a) * u.rad);
        c.material.opacity = 0.85 * (1 - night * 0.6);
      }
      // fountains
      for (const f of fountains) {
        for (let i = 0; i < f.vel.length; i++) {
          const v = f.vel[i];
          const age = (t * 1.2 + v.t) % 1.6;
          const rr = v.s * age;
          f.pos[i * 3] = Math.cos(v.a) * rr * 0.5;
          f.pos[i * 3 + 1] = 28 + v.v * age - 60 * age * age;
          f.pos[i * 3 + 2] = Math.sin(v.a) * rr * 0.5;
        }
        f.geo.attributes.position.needsUpdate = true;
        f.water.position.y = 8.4 + Math.sin(t * 2) * 0.25;
      }
      for (const fn of animated) fn(t);
      // your mission's door glows and its sign pulses
      for (let i = 0; i < doorGlows.length; i++) {
        const d = doorGlows[i];
        const on = i === targetDoorIdx;
        d.mat.opacity = on ? 0.45 + 0.35 * Math.sin(t * 5) : 0;
      }
      // buildings between the camera and you turn see-through
      for (let i = 0; i < buildings.length; i++) {
        const bd = buildings[i];
        const a = bd.aabb;
        tmpDir.set(focus.x - camPos.x, 44 - camPos.y, focus.z - camPos.z);
        const len = tmpDir.length();
        tmpDir.divideScalar(len);
        // slab test of the camera->player segment against the building box
        let t0 = 0;
        let t1 = len;
        const test = (o, d, lo, hi) => {
          if (Math.abs(d) < 1e-6) return o >= lo && o <= hi;
          let n0 = (lo - o) / d;
          let n1 = (hi - o) / d;
          if (n0 > n1) [n0, n1] = [n1, n0];
          t0 = Math.max(t0, n0);
          t1 = Math.min(t1, n1);
          return t0 <= t1;
        };
        const hit = test(camPos.x, tmpDir.x, a.x0 - 6, a.x1 + 6) && test(camPos.y, tmpDir.y, 0, a.top) && test(camPos.z, tmpDir.z, a.z0 - 6, a.z1 + 6) && t0 < len - 20;
        const goal = hit ? 0.22 : 1;
        bd.opacity += (goal - bd.opacity) * Math.min(1, dt * 7);
        const tr = bd.opacity < 0.985;
        for (const m of bd.mats) {
          if (m.transparent !== tr) {
            m.transparent = tr;
            m.needsUpdate = true;
          }
          if (m.isMeshBasicMaterial && m === bd.signMat) m.opacity = bd.opacity;
          else m.opacity = bd.opacity;
        }
      }
    }

    return { root, sun, hemi, fog, sky, setTime, update, buildings, get night() { return night; }, glow, envMats, std, tex };
  }

  return { build };
})();
