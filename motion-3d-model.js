// Dimensions use the same units as the movement timelines. X points forward,
// Y down and Z across the athlete. The camera can orbit this scene freely.
const buildMovementScene3D = (() => {
  const skin = '#cd936d', shirt = '#397560', shorts = '#253f39';
  const hair = '#263631', shoe = '#e6e7d2', rubber = '#596b62';
  const active = '#f79858', steel = '#687e73', darkSteel = '#344940', metal = '#b9c6ba';
  const wideGrip = new Set(['snatch', 'power-snatch', 'overhead-squat']);
  const xyz = (p, z = 0) => [p[0], p[1], z];
  const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
  const offset = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];
  const between = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
  ];

  function segmentBasis(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz) || 1, profile = Math.hypot(dx, dy);
    const axis = [dx / length, dy / length, dz / length];
    const front = profile > 0.0001 ? [dy / profile, -dx / profile, 0] : [1, 0, 0];
    const side = [front[1] * axis[2], -front[0] * axis[2], front[0] * axis[1] - front[1] * axis[0]];
    return { axis, front, side, length };
  }

  function build(motion, pose, regionIds = []) {
    const parts = [], regions = new Set(regionIds);
    const tube = (a, b, r1, r2, color) => parts.push({ type: 'tube', a, b, r1, r2, color });
    const ellipsoid = (center, axes, color) => parts.push({ type: 'ellipsoid', center, axes, color });
    const axes = (x, y, z) => [[x, 0, 0], [0, y, 0], [0, 0, z]];
    const oval = (center, x, y, z, color) => ellipsoid(center, axes(x, y, z), color);
    const box = (center, x, y, z, color) => parts.push({ type: 'box', center, axes: axes(x, y, z), color });

    function anatomicalOval(center, basis, depth, length, width, color) {
      ellipsoid(center, [scale(basis.front, depth), scale(basis.axis, length), scale(basis.side, width)], color);
    }

    function muscle(id, a, b, t, displacement, depth, length, width, outer = 0) {
      if (!regions.has(id)) return;
      const basis = segmentBasis(a, b);
      const center = offset(offset(between(a, b, t), basis.front, displacement), basis.side, outer);
      anatomicalOval(center, basis, depth, length, width, active);
    }

    // Hands meet the shaft, ring of the handle, or sides of the ball on the
    // actual equipment width. A wide snatch and narrow kettlebell grip are
    // distinct from the front as well as in profile.
    const handWidthByEquipment = { rig: 17, rope: 22, kettlebell: 4, ball: 4.7, rower: 10.5, wall: 17, mat: 5 };
    const handWidth = pose.ringGripWidth ?? (motion.equipment === 'barbell'
      ? (wideGrip.has(motion.id) ? 32 : 17)
      : (handWidthByEquipment[motion.equipment] || 15));
    const head = xyz(pose.head), shoulder = xyz(pose.shoulder), hip = xyz(pose.hip);
    const trunk = segmentBasis(shoulder, hip);
    anatomicalOval(between(shoulder, hip, .29), trunk, 8.7, trunk.length * .43, 15.2, shirt);
    anatomicalOval(between(shoulder, hip, .66), trunk, 7.8, trunk.length * .34, 10.9, shirt);
    anatomicalOval(between(shoulder, hip, .94), trunk, 8.5, 8.2, 11.7, shorts);
    tube(shoulder, between(shoulder, head, .79), 4.4, 3.9, skin);

    // Head basis points from crown towards neck so its front stays anatomical
    // when the athlete is supine, prone or upside down.
    const face = segmentBasis(head, shoulder);
    anatomicalOval(head, face, 7.2, 9.2, 6.6, skin);
    const cap = offset(offset(head, face.axis, -4), face.front, -1.2);
    anatomicalOval(cap, face, 7.1, 5.9, 6.65, hair);
    anatomicalOval(offset(offset(head, face.front, 6.7), face.axis, 1.4), face, 2, 2.1, 1.45, skin);

    for (const sign of [-1, 1]) {
      const eye = offset(offset(head, face.front, 6.3), face.axis, -1.3);
      oval(xyz(eye, sign * 2.8), .8, .85, .6, hair);
      anatomicalOval(xyz(head, sign * 6.2), face, 1.65, 2.3, 1.05, skin);

      const rear = sign < 0 && pose.rearKnee;
      const butterfly = motion.id === 'sit-up';
      const hanging = motion.equipment === 'rig' || motion.equipment === 'rings';
      const footWidth = butterfly ? 3.1 : hanging ? 5.2 : 9;
      const legHip = xyz(pose.hip, sign * 7.5);
      const knee = xyz(rear ? pose.rearKnee : pose.knee, sign * (butterfly ? 26 : footWidth + 1));
      const ankle = xyz(rear ? pose.rearAnkle : pose.ankle, sign * footWidth);
      const toe = xyz(rear ? pose.rearToe : pose.toe, sign * footWidth);
      tube(legHip, knee, 6.4, 4.5, skin);
      tube(legHip, between(legHip, knee, .50), 7, 6.15, shorts);
      oval(knee, 4.55, 4.55, 4.55, skin);
      tube(knee, ankle, 4.6, 2.65, skin);
      tube(between(knee, ankle, .78), ankle, 3.45, 3, shoe);
      const platform = motion.equipment === 'box' && toe[0] >= motion.anchor[0] ? motion.anchor[1] : 202;
      if (Math.abs(platform - toe[1]) < 1.5 && toe[0] - ankle[0] > 7 && toe[1] - ankle[1] < 10) {
        const heelX = ankle[0] - 3, length = toe[0] + .6 - heelX, centerX = heelX + length / 2;
        box([centerX, platform - .7, toe[2]], length / 2, .7, 3.05, rubber);
        oval([centerX - .5, platform - 2.6, toe[2]], length / 2, 2.6, 3.3, shoe);
      } else {
        const sole = segmentBasis(ankle, toe);
        anatomicalOval(between(ankle, toe, .42), sole, 3.05, sole.length * .62, 3.3, shoe);
      }
      muscle('quads', legHip, knee, .47, 4.5, 2.3, 9, 3.5, sign * 1.3);
      muscle('hamstrings', legHip, knee, .48, -4.3, 2.4, 8.9, 3.7, sign * 1.3);
      muscle('calves', knee, ankle, .33, -2.85, 2.15, 6.5, 3, sign * .7);

      const upper = xyz(pose.shoulder, sign * 13.2);
      const elbow = xyz(pose.elbow, sign * (13.2 + (handWidth - 13.2) * .53 + 1.6));
      const wrist = xyz(pose.wrist, sign * handWidth);
      tube(upper, elbow, 4.9, 3.3, skin);
      oval(upper, 5.45, 5.45, 5.45, regions.has('shoulders') ? active : shirt);
      tube(upper, between(upper, elbow, .23), 5.35, 4.95, shirt);
      oval(elbow, 3.45, 3.45, 3.45, skin);
      tube(elbow, wrist, 3.7, 2.3, skin);
      tube(between(elbow, wrist, .78), between(elbow, wrist, .86), 2.9, 2.7, shoe);
      oval(wrist, 2.95, 2.9, 2.35, skin);
      muscle('biceps', upper, elbow, .52, 2.95, 1.85, 5.4, 2.45, sign * .7);
      muscle('triceps', upper, elbow, .51, -2.95, 1.85, 5.8, 2.55, sign * .75);
      muscle('forearms', elbow, wrist, .4, .65, 2.6, 6, 1.8, sign * 2.1);

      // Paired surface patches keep front and rear areas distinguishable
      // when the athlete is viewed head-on. The central core is added once.
      muscle('chest', shoulder, hip, .25, 6.1, 2.9, 5.9, 5.2, sign * 6);
      muscle('back', shoulder, hip, .32, -6.1, 2.9, 8.6, 5.35, sign * 5.65);
      muscle('hipFlexors', shoulder, hip, .89, 5.45, 2.45, 4.2, 3.15, sign * 5.8);
      muscle('glutes', shoulder, hip, .97, -5.6, 3.4, 6.3, 4.8, sign * 5.2);
    }
    muscle('core', shoulder, hip, .62, 6.35, 2.45, 7.5, 6.7);

    const anchor = motion.anchor;
    const grip = xyz(pose.wrist);
    switch (motion.equipment) {
      case 'barbell': {
        const [x, y] = pose.gear;
        tube([x, y, -56], [x, y, 56], 1.1, 1.1, metal);
        for (const sign of [-1, 1]) {
          tube([x, y, 39 * sign], [x, y, 42 * sign], 2.2, 2.2, metal);
          tube([x, y, 42 * sign], [x, y, 47 * sign], 16.7, 16.7, darkSteel);
          tube([x, y, 47 * sign], [x, y, 48 * sign], 12.8, 12.8, steel);
          tube([x, y, 48 * sign], [x, y, 51 * sign], 3.15, 3.15, metal);
        }
        break;
      }
      case 'rig': {
        const [x, y] = anchor;
        for (const sign of [-1, 1]) {
          const z = sign * 43;
          box([x - 31, (202 + y) / 2, z], 1.85, (202 - y) / 2, 1.8, steel);
          box([x - 16, y, z], 16, 1.75, 1.8, steel);
          tube([x - 31, y + 25, z], [x - 12, y, z], 1.15, 1.15, steel);
          box([x - 31, 200.8, z], 9, 1.2, 3.5, darkSteel);
        }
        tube([x, y, -44], [x, y, 44], 1.65, 1.65, darkSteel);
        break;
      }
      case 'rings': {
        const [x, y] = anchor;
        box([x, y - 2, 0], 2.2, 1.6, 38, steel);
        for (const sign of [-1, 1]) {
          const z = sign * 37;
          box([x - 46, (202 + y - 2) / 2, z], 1.4, (202 - y + 2) / 2, 1.4, steel);
          box([x - 23, y - 2, z], 23, 1.6, 1.4, steel);
          tube([x - 46, y + 15, z], [x - 29, y - 2, z], 1, 1, metal);
          box([x - 46, 201, z], 6, 1, 3, darkSteel);
          const { mount, top, points } = movementRingGeometry(anchor, pose, sign);
          tube(mount, top, 1.15, 1.15, darkSteel);
          tube(between(mount, top, .21), between(mount, top, .27), 1.65, 1.65, metal);
          for (let i = 1; i < points.length; i++) {
            tube(points[i - 1], points[i], 1.45, 1.45, '#bb834f');
          }
        }
        break;
      }
      case 'box': {
        const [x, y] = anchor;
        box([x + 37, (y + 202) / 2, 0], 37, (202 - y) / 2, 26, '#cbaa7e');
        box([x + 37, y + 1.1, 0], 37.3, 1.1, 26.3, '#e5cba3');
        for (const sign of [-1, 1]) box([x + 37, y + 15, sign * 26.15], 6.3, 1.4, .32, '#816749');
        break;
      }
      case 'wall':
      case 'ball': {
        const wallX = anchor[0] + 1.1;
        // An open-backed wall section shows the plane of contact without
        // hiding the whole athlete as the viewer orbits behind the wall.
        for (const sign of [-1, 1]) box([wallX + 1, 109, sign * 27], 1.3, 93, 1.45, '#97a89e');
        for (const y of [18, 79, 141, 200]) box([wallX + 1.5, y, 0], .8, .8, 27, '#aebbb0');
        if (motion.equipment === 'wall') {
          // The heels slide along this fixed section during a handstand push-up.
          box([wallX, 64, 0], 1.05, 21, 27, '#b3c3b7');
        } else {
          const [x, y] = anchor;
          tube([x + .5, y, 0], [x + 2, y, 0], 10.7, 10.7, '#b9824b');
          tube([x, y, 0], [x + .5, y, 0], 6.8, 6.8, '#dfb474');
          oval(xyz(pose.gear), 8.2, 8.2, 8.2, '#cb9946');
        }
        break;
      }
      case 'mat':
        box([anchor[0], 201, 0], 16, 1, 11.5, rubber);
        oval([anchor[0], 198.2, 0], 18, 3.75, 13, '#6c8176');
        break;
      case 'kettlebell': {
        const bell = xyz(pose.gear), base = between(grip, bell, .75);
        tube(xyz(grip, -6), xyz(grip, 6), 1.8, 1.8, darkSteel);
        for (const sign of [-1, 1]) tube(xyz(grip, sign * 6), xyz(base, sign * 5.8), 1.75, 1.8, darkSteel);
        oval(bell, 7.7, 7.7, 7.6, '#536b61');
        break;
      }
      case 'rope': {
        const angle = pose.ropeAngle;
        const radiusY = Math.sin(angle) >= 0 ? pose.toe[1] - grip[1] + 5 : grip[1] - pose.head[1] + 12;
        const dx = 52 * Math.cos(angle), dy = Math.max(32, radiusY) * Math.sin(angle);
        let previous = xyz(grip, -handWidth);
        for (let i = 1; i <= 20; i++) {
          const lateral = -Math.cos(i * Math.PI / 20);
          // Leave a broad bend at the far side of the loop so the rope passes
          // beneath both shoes, not just the center point between them.
          const curve = Math.sqrt(1 - lateral ** 4);
          const point = [grip[0] + dx * curve, grip[1] + dy * curve, handWidth * lateral];
          tube(previous, point, .82, .82, '#a56837');
          previous = point;
        }
        break;
      }
      case 'rower': {
        const [x, y] = anchor, flywheel = [x + 44, y - 17], railY = y + 9;
        box([157, railY + 1.5, 0], 64, 2, 3.4, steel);
        box([102, 198.5, 0], 3.6, 2.8, 18, darkSteel);
        box([x + 43, 198.5, 0], 3.6, 2.8, 18, darkSteel);
        tube([102, railY, 0], [102, 197, 0], 2.2, 2.2, steel);
        tube([x + 43, y - 6, 0], [x + 43, 197, 0], 3.6, 3.6, steel);
        tube([x + 4, railY, 0], xyz(flywheel), 3, 3, darkSteel);
        tube(xyz(flywheel, -9), xyz(flywheel, 9), 15.4, 15.4, steel);
        for (const sign of [-1, 1]) {
          tube(xyz(flywheel, sign * 9), xyz(flywheel, sign * 9.7), 11.8, 11.8, metal);
          tube(xyz(flywheel, sign * 9.7), xyz(flywheel, sign * 10.3), 4.2, 4.2, darkSteel);
          const a = [x - 3, y + 5, sign * 9], b = [x + 10, y - 13, sign * 9];
          anatomicalOval(between(a, b, .5), segmentBasis(a, b), 2, 12, 4, rubber);
        }
        box([hip[0], railY - 3.2, 0], 8.6, 2.4, 10.6, darkSteel);
        tube([flywheel[0] - 11, flywheel[1] - 2, 0], grip, .65, .65, steel);
        tube(xyz(grip, -13), xyz(grip, 13), 1.7, 1.7, darkSteel);
        break;
      }
    }
    return parts;
  }
  return build;
})();
