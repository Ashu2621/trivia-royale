/*
 * Soldier — the shared rigged 3D character (Mixamo "Vanguard", models/Soldier.glb) used by the
 * City / Mansion renderers.
 *
 * On top of the model's Idle / Walk / Run clips it adds procedural body language driven by the
 * game state — most importantly the "I really gotta go" acting: fidgeting, knees squeezed
 * together, both hands clamped between the legs, a hunched hopping waddle, a hand flying to the
 * back for a clench, and the shame pose after an accident. The arms are posed with a small
 * two-bone IK so the hands really land where they should, whatever animation is playing.
 */
const Soldier = (function () {
  'use strict';

  const T = THREE;
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = (a, b, x) => {
    const k = clamp((x - a) / (b - a), 0, 1);
    return k * k * (3 - 2 * k);
  };

  let gltf = null;
  let wait = null;

  function load(url) {
    if (wait) return wait;
    wait = new Promise((resolve) => {
      if (!T.GLTFLoader || !T.SkeletonUtils) return resolve();
      new T.GLTFLoader().load(
        url || 'models/Soldier.glb',
        (g) => {
          gltf = g;
          resolve();
        },
        undefined,
        (err) => {
          console.warn('soldier model failed to load', err);
          resolve();
        }
      );
    });
    return wait;
  }
  const ready = () => !!gltf;

  const _q = new T.Quaternion();
  const _q2 = new T.Quaternion();
  const _v1 = new T.Vector3();
  const _v2 = new T.Vector3();
  const _v3 = new T.Vector3();
  const _v4 = new T.Vector3();

  const BONES = {
    hips: 'mixamorigHips',
    spine: 'mixamorigSpine',
    spine1: 'mixamorigSpine1',
    spine2: 'mixamorigSpine2',
    neck: 'mixamorigNeck',
    head: 'mixamorigHead',
    lArm: 'mixamorigLeftArm',
    lFore: 'mixamorigLeftForeArm',
    lHand: 'mixamorigLeftHand',
    rArm: 'mixamorigRightArm',
    rFore: 'mixamorigRightForeArm',
    rHand: 'mixamorigRightHand',
    lUp: 'mixamorigLeftUpLeg',
    lLeg: 'mixamorigLeftLeg',
    lFoot: 'mixamorigLeftFoot',
    rUp: 'mixamorigRightUpLeg',
    rLeg: 'mixamorigRightLeg',
    rFoot: 'mixamorigRightFoot',
  };

  /**
   * opts: { scale, tint (css color), tintMix, yaw (model yaw inside the root), forward ('x' | 'z'),
   *         castShadow, envMats (array to push materials into), gun (bool) }
   */
  function create(opts) {
    const o = opts || {};
    const scale = o.scale || 27;
    const root = new T.Group();
    const inner = T.SkeletonUtils.clone(gltf.scene);
    inner.scale.setScalar(scale);
    // the model's front faces -Z in its own space; turn it so it faces the root's forward axis
    inner.rotation.y = o.yaw === undefined ? (o.forward === 'z' ? Math.PI : -Math.PI / 2) : o.yaw;
    root.add(inner);
    const tint = new T.Color(o.tint || '#ffffff').lerp(new T.Color('#ffffff'), o.tintMix === undefined ? 0.5 : o.tintMix);
    const mats = [];
    inner.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = o.castShadow !== false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.material = m.material.clone();
      if (/body/i.test(m.material.name)) {
        m.material.color.copy(tint);
        mats.push(m.material);
      }
      m.material.roughness = 0.62;
      if (o.envMats) o.envMats.push(m.material);
    });
    const mixer = new T.AnimationMixer(inner);
    const acts = {};
    for (const name of ['Idle', 'Walk', 'Run']) {
      const a = mixer.clipAction(T.AnimationClip.findByName(gltf.animations, name));
      a.play();
      a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
      acts[name] = a;
    }
    mixer.update(Math.random() * 2);
    const bones = {};
    for (const k of Object.keys(BONES)) bones[k] = inner.getObjectByName(BONES[k]);
    // limb lengths from the bind pose (in world units)
    inner.updateMatrixWorld(true);
    const wp = (b) => b.getWorldPosition(new T.Vector3());
    const lens = {
      upper: wp(bones.lArm).distanceTo(wp(bones.lFore)),
      fore: wp(bones.lFore).distanceTo(wp(bones.lHand)),
    };
    const obj = {
      root,
      inner,
      mixer,
      acts,
      w: { Idle: 1, Walk: 0, Run: 0 },
      bones,
      lens,
      scale,
      mats,
      tint,
      fwd: o.forward === 'z' ? new T.Vector3(0, 0, 1) : new T.Vector3(1, 0, 0),
      side: o.forward === 'z' ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, -1), // the character's LEFT
      pose: { hold: 0, squeeze: 0, hunch: 0, clench: 0, shame: 0, shout: 0, butt: 0 },
      hopPhase: Math.random() * TAU,
      gun: null,
      tip: null,
    };
    if (o.gun) attachGun(obj);
    return obj;
  }

  function attachGun(obj) {
    const gun = new T.Group();
    gun.visible = false;
    const hand = obj.bones.rHand;
    if (hand) {
      const ws = new T.Vector3();
      hand.getWorldScale(ws);
      gun.scale.setScalar(1 / (ws.x || 0.27));
      gun.position.set(0, 6, 3);
      gun.rotation.set(0, 0, Math.PI / 2);
      hand.add(gun);
    } else obj.root.add(gun);
    const metal = new T.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.7 });
    const add = (geo, mat, x, y, z) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      gun.add(m);
      return m;
    };
    add(new T.BoxGeometry(2.6, 15, 3), metal, 0, -3, 0);
    add(new T.CylinderGeometry(0.7, 0.7, 8, 6), new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.8 }), 0, -14, 0);
    add(new T.BoxGeometry(2, 4.6, 2.4), new T.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.4 }), 2.4, -3.5, 0);
    add(new T.BoxGeometry(2, 5, 2), new T.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.4, metalness: 0.6 }), -1.9, -1, 0);
    const tip = add(new T.SphereGeometry(1.6, 6, 6), new T.MeshBasicMaterial({ color: 0xffa040, toneMapped: false }), 0, -19, 0);
    tip.visible = false;
    obj.gun = gun;
    obj.tip = tip;
  }

  // aim a bone so its child sits along the given WORLD direction
  function aim(bone, child, dirWorld) {
    _v1.copy(child.position).normalize();
    bone.parent.getWorldQuaternion(_q).invert();
    _v2.copy(dirWorld).applyQuaternion(_q).normalize();
    bone.quaternion.setFromUnitVectors(_v1, _v2);
  }

  // Two-bone IK: put a hand at `target` (world), elbow bent toward `pole`. Blended by k.
  function armIK(obj, upperB, foreB, handB, target, pole, k) {
    if (k <= 0.001) return;
    const S = upperB.getWorldPosition(_v3.clone());
    const a = obj.lens.upper;
    const b = obj.lens.fore;
    const toT = target.clone().sub(S);
    let d = toT.length();
    const dir = toT.normalize();
    d = clamp(d, Math.abs(a - b) + 0.01, a + b - 0.01);
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const pv = pole.clone().sub(S); // `pole` is a world-space hint POINT for the elbow
    const perp = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    const E = S.clone().add(dir.clone().multiplyScalar(x)).add(perp.multiplyScalar(h));
    const T2 = S.clone().add(dir.clone().multiplyScalar(d));
    const qUp0 = upperB.quaternion.clone();
    const qFo0 = foreB.quaternion.clone();
    aim(upperB, foreB, E.clone().sub(S));
    upperB.updateMatrixWorld(true);
    aim(foreB, handB, T2.clone().sub(E));
    if (k < 0.999) {
      upperB.quaternion.slerpQuaternions(qUp0, upperB.quaternion, k);
      foreB.quaternion.slerpQuaternions(qFo0, foreB.quaternion, k);
    }
    upperB.updateMatrixWorld(true);
  }

  // convert a point given in the character's root-local frame (forward, up, side) to world space
  function local(obj, fwd, up, side) {
    const s = obj.scale / 27;
    return obj.root.localToWorld(new T.Vector3().addScaledVector(obj.fwd, fwd * s).addScaledVector(obj.side, side * s).setY(up * s));
  }

  function bend(bone, axis, angle, k) {
    if (k <= 0.001) return;
    _q2.setFromAxisAngle(axis, angle * k);
    bone.quaternion.multiply(_q2);
  }
  // pose tuning (radians / world units at scale 27) — exposed so it can be adjusted live
  const TUNE = { hips: 0, spine: 0.42, spine1: 0.28, spine2: 0.18, head: 0.25, sag: 1.5, hand: [5.5, -1.5, 2.2] };
  const AX = new T.Vector3(1, 0, 0);
  const AY = new T.Vector3(0, 1, 0);
  const AZ = new T.Vector3(0, 0, 1);

  /**
   * s: { moving, speed, stunned, thinking, finished, flash, armed,
   *      hold, squeeze, hunch, clench, shame, shout, hop, time }   (pose values 0..1)
   */
  function update(obj, dt, s) {
    const go = s.moving && !s.stunned && !s.thinking;
    const target = { Idle: go ? 0 : 1, Walk: go && s.speed < 105 ? 1 : 0, Run: go && s.speed >= 105 ? 1 : 0 };
    const kk = Math.min(1, dt * 9);
    for (const n of ['Idle', 'Walk', 'Run']) {
      obj.w[n] += (target[n] - obj.w[n]) * kk;
      obj.acts[n].setEffectiveWeight(Math.max(0.0001, obj.w[n]));
    }
    // a desperate waddle is slow and stiff
    const desperate = clamp(s.hold || 0, 0, 1);
    const slow = 1 - 0.35 * desperate;
    obj.acts.Walk.setEffectiveTimeScale(clamp((s.speed / 38) * slow, 0.6, 2.2));
    obj.acts.Run.setEffectiveTimeScale(clamp((s.speed / 125) * slow, 0.6, 1.9));
    obj.acts.Idle.setEffectiveTimeScale(s.stunned ? 0.4 : 1);
    obj.mixer.update(dt);

    // ease the pose values so poses blend in and out
    const p = obj.pose;
    const ease = Math.min(1, dt * 7);
    for (const key of ['hold', 'squeeze', 'hunch', 'clench', 'shame', 'shout', 'butt']) p[key] += ((s[key] || 0) - p[key]) * ease;

    const anyPose = p.hold + p.squeeze + p.hunch + p.clench + p.shame + p.shout + p.butt > 0.01;
    const t = s.time || 0;
    if (anyPose) {
      obj.root.updateMatrixWorld(true);
      const B = obj.bones;
      const s2 = obj.scale / 27;
      const fid = Math.sin(t * 9 + obj.hopPhase) * 0.5 + 0.5;
      // holding it means bending over: hips and back fold forward so the hands can reach
      const hunch = Math.max(p.hunch, p.hold * 0.9);
      bend(B.hips, AX, TUNE.hips * hunch, 1);
      bend(B.spine, AX, TUNE.spine * hunch, 1);
      bend(B.spine1, AX, TUNE.spine1 * hunch, 1);
      bend(B.spine2, AX, TUNE.spine2 * hunch, 1);
      bend(B.head, AX, TUNE.head * hunch, 1);
      if (p.squeeze > 0.01) {
        for (const [up, sgn] of [[B.lUp, 1], [B.rUp, -1]]) {
          bend(up, AZ, sgn * 0.42 * p.squeeze, 1);
          bend(up, AX, -0.18 * p.squeeze * (0.5 + 0.5 * fid), 1);
        }
      }
      obj.inner.updateMatrixWorld(true);
      // hands: clamp between the legs, clench the back, cup the mouth (shout), cover the face (shame)
      const hipsW = B.hips.getWorldPosition(new T.Vector3());
      const at = (f, u, sd) => hipsW.clone().addScaledVector(obj.fwd, f * s2).addScaledVector(obj.side, sd * s2).add(new T.Vector3(0, u * s2, 0));
      const holdK = clamp(p.hold - p.butt * 0.8, 0, 1);
      if (holdK > 0.01) {
        const jitter = Math.sin(t * 13 + obj.hopPhase) * 0.5 * p.hold;
        const [hf, hu, hs] = TUNE.hand;
        armIK(obj, B.lArm, B.lFore, B.lHand, at(hf, hu + jitter, hs), local(obj, -2, -6, 12), holdK);
        armIK(obj, B.rArm, B.rFore, B.rHand, at(hf, hu - jitter, -hs), local(obj, -2, -6, -12), holdK);
      }
      if (p.butt > 0.01) {
        armIK(obj, B.rArm, B.rFore, B.rHand, at(-7, 1, -4), local(obj, -8, 8, -14), p.butt);
        armIK(obj, B.lArm, B.lFore, B.lHand, at(TUNE.hand[0], TUNE.hand[1], TUNE.hand[2]), local(obj, -2, -6, 12), p.butt * p.hold);
      }
      if (p.shout > 0.01) {
        armIK(obj, B.lArm, B.lFore, B.lHand, local(obj, 9, 44, 4.5), local(obj, -2, 8, 14), p.shout);
        armIK(obj, B.rArm, B.rFore, B.rHand, local(obj, 9, 44, -4.5), local(obj, -2, 8, -14), p.shout);
      }
      if (p.shame > 0.01) {
        armIK(obj, B.lArm, B.lFore, B.lHand, local(obj, 7, 43, 3.2), local(obj, -2, 8, 14), p.shame);
        armIK(obj, B.rArm, B.rFore, B.rHand, local(obj, 7, 43, -3.2), local(obj, -2, 8, -14), p.shame);
        bend(B.head, AX, -0.4, p.shame);
        bend(B.spine, AX, 0.3, p.shame);
      }
    }
    // the whole body hops and shivers with desperation
    const hopAmp = (s.hop || 0) * 4.2 * (obj.scale / 27);
    const hop = hopAmp * Math.abs(Math.sin(t * (9 + 5 * (s.hop || 0)) + obj.hopPhase));
    obj.inner.position.y = s.finished ? Math.abs(Math.sin(t * 7)) * 6 : hop;
    obj.inner.rotation.z = s.stunned ? Math.sin(t * 5) * 0.28 : Math.sin(t * 11 + obj.hopPhase) * 0.09 * (s.hop || 0);
    obj.inner.rotation.x = s.stunned ? 0.22 : 0;
    if (obj.gun) {
      obj.gun.visible = !!s.armed && p.hold < 0.5;
      obj.tip.visible = false;
    }
  }

  return { load, ready, create, update, attachGun, smooth, tune: TUNE };
})();
