// Coordinates are a side elevation, with the floor at y=202 on a 320 × 220 stage.
const movementDrawing = (() => {
  const ink = '#243d39', skin = '#d39770', farSkin = '#a77156';
  const jersey = '#39795f', shorts = '#23453f', lime = '#d4ed88';

  function line(ctx, points, color, width) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function shape(ctx, points, fill, outline) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function oval(ctx, [x, y], rx, ry, fill, outline) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1.3; ctx.stroke(); }
  }

  // A tapered capsule connects two joints without discontinuities at the ends.
  function segment(ctx, a, b, startRadius, endRadius, fill) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length;
    shape(ctx, [
      [a[0] + nx * startRadius, a[1] + ny * startRadius],
      [b[0] + nx * endRadius, b[1] + ny * endRadius],
      [b[0] - nx * endRadius, b[1] - ny * endRadius],
      [a[0] - nx * startRadius, a[1] - ny * startRadius]
    ], fill);
    oval(ctx, a, startRadius, startRadius, fill);
    oval(ctx, b, endRadius, endRadius, fill);
  }

  function along(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  // Each patch has a start and end along its body segment, a lateral offset
  // (positive toward the front), and a width radius in stage coordinates.
  const musclePatches = {
    thigh: { quads: [.19, .83, 2.2, 2.5], hamstrings: [.20, .78, -2.4, 2.25] },
    shin: { calves: [.14, .61, -1.4, 2.15] },
    trunk: {
      chest: [.07, .36, 3.7, 3.2], back: [.07, .59, -3.8, 3.35],
      core: [.42, .80, 3.1, 3.1], hipFlexors: [.80, 1.02, 3.6, 2.4],
      glutes: [.84, 1.10, -2.9, 3.75],
    },
    upperArm: {
      shoulders: [-.10, .26, 0, 4.1],
      biceps: [.25, .81, 1.55, 1.8], triceps: [.17, .82, -1.7, 1.8],
    },
    forearm: { forearms: [.12, .69, 0, 2.2] },
  };

  function paintMuscles(ctx, regions, patches, a, b) {
    if (!regions.length) return;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (!length) return;
    const angle = Math.atan2(dy, dx);
    for (const region of regions) {
      if (!Object.hasOwn(patches, region)) continue;
      const [start, end, offset, width] = patches[region];
      const middle = (start + end) / 2;
      const x = a[0] + dx * middle + dy / length * offset;
      const y = a[1] + dy * middle - dx / length * offset;
      ctx.beginPath();
      ctx.ellipse(x, y, length * (end - start) / 2, width, angle, 0, Math.PI * 2);
      ctx.fillStyle = '#f79858'; ctx.fill();
      ctx.strokeStyle = '#9d4626'; ctx.lineWidth = .9; ctx.stroke();
    }
  }

  function shoe(ctx, ankle, toe, far, supportY) {
    const length = Math.hypot(toe[0] - ankle[0], toe[1] - ankle[1]);
    const lateral = toe[0] - ankle[0];
    const onSurface = Math.abs(toe[1] - supportY) <= 1.5 && lateral > 7 &&
      toe[1] >= ankle[1] && toe[1] - ankle[1] <= 9;
    if (onSurface) {
      const [x,y] = ankle, edge = toe[0];
      shape(ctx, [[x-3,y-2],[x+2,y-2],[x+5,y+1],[edge,supportY-2],[edge+.5,supportY],
        [x-4,supportY],[x-4,supportY-3]], far ? '#526962' : '#e9eedc', ink);
      line(ctx, [[x+3,y+.4],[x+5,y+2]], far ? '#869687' : '#73867a', 1.4);
      return;
    }
    ctx.save();
    ctx.translate(...ankle);
    ctx.rotate(Math.atan2(toe[1] - ankle[1], toe[0] - ankle[0]));
    shape(ctx, [[-3,-2],[1,-3],[length*.46,-2],[length,-1.3],[length+.5,.4],[length*.8,1.5],[-3,2]], far ? '#526962' : '#e9eedc', ink);
    line(ctx, [[length*.24,-2.3],[length*.46,-.6]], far ? '#869687' : '#73867a', 1.4);
    ctx.restore();
  }

  function leg(ctx, hip, knee, ankle, toe, far, supportY, regions) {
    const tint = far ? farSkin : skin;
    segment(ctx, hip, knee, 6.4, 4.4, tint);
    segment(ctx, knee, ankle, 4.6, 2.7, tint);
    segment(ctx, hip, along(hip, knee, .48), 7.2, 6.1, far ? '#182f2c' : shorts);
    segment(ctx, along(knee, ankle, .80), ankle, 3.4, 2.9, far ? '#9da99e' : '#e4e7d4');
    paintMuscles(ctx, regions, musclePatches.thigh, hip, knee);
    paintMuscles(ctx, regions, musclePatches.shin, knee, ankle);
    shoe(ctx, ankle, toe, far, supportY);
  }

  function arm(ctx, shoulder, elbow, wrist, far, regions) {
    const tint = far ? farSkin : skin;
    segment(ctx, shoulder, elbow, 4.6, 3.45, tint);
    segment(ctx, elbow, wrist, 3.65, 2.5, tint);
    oval(ctx, wrist, 3.1, 2.8, tint);
    segment(ctx, shoulder, along(shoulder, elbow, .23), 5.5, 4.9, far ? '#2e584b' : jersey);
    paintMuscles(ctx, regions, musclePatches.upperArm, shoulder, elbow);
    paintMuscles(ctx, regions, musclePatches.forearm, elbow, wrist);
  }

  // The side illustration offsets the far hand slightly to show both rings.
  // The rotatable model uses their actual lateral positions.
  const farRingOffset = -7;
  function ringLoop(ctx, points, far = false) {
    const offset = far ? farRingOffset : 0;
    const path = points.map(([x, y]) => [x + offset, y]);
    line(ctx, path, far ? '#876c4f' : '#694b35', 3.6);
    line(ctx, path, far ? '#c0a37b' : '#dfa86e', 2);
  }

  function athlete(ctx, p, motion, regions, rings) {
    const supportHeight = toe => motion.equipment === 'box' && toe[0] >= motion.anchor[0]
      ? motion.anchor[1] : 202;
    const rearToe = p.rearToe || p.toe;
    ctx.save();
    ctx.translate(-3, 0);
    leg(ctx, p.hip, p.rearKnee || p.knee, p.rearAnkle || p.ankle, rearToe, true, supportHeight(rearToe), p.rearKnee ? regions : []);
    if (rings) {
      const offset = farRingOffset + 3;
      arm(ctx, p.shoulder, [p.elbow[0] + offset / 2, p.elbow[1]], [p.wrist[0] + offset, p.wrist[1]], true, []);
    } else {
      arm(ctx, p.shoulder, p.elbow, p.wrist, true, []);
    }
    ctx.restore();
    leg(ctx, p.hip, p.knee, p.ankle, p.toe, false, supportHeight(p.toe), regions);

    const neck = along(p.shoulder, p.head, .68);
    segment(ctx, p.shoulder, neck, 4.7, 3.8, skin);
    segment(ctx, p.shoulder, p.hip, 8.4, 7.2, jersey);
    const chest = along(p.shoulder, p.hip, .15);
    const waist = along(p.shoulder, p.hip, .80);
    const sideAngle = Math.atan2(p.hip[1] - p.shoulder[1], p.hip[0] - p.shoulder[0]) + Math.PI / 2;
    const sideX = Math.cos(sideAngle), sideY = Math.sin(sideAngle);
    line(ctx, [[chest[0]+sideX*6,chest[1]+sideY*6],[waist[0]+sideX*5,waist[1]+sideY*5]], '#76a88a', 1.7);
    segment(ctx, along(p.shoulder,p.hip,.89), p.hip, 7.2, 7.2, shorts);
    paintMuscles(ctx, regions, musclePatches.trunk, p.shoulder, p.hip);
    if (rings) ringLoop(ctx, rings[1].points);
    arm(ctx, p.shoulder, p.elbow, p.wrist, false, regions);
    const cuff = along(p.elbow, p.wrist, .79);
    line(ctx, [cuff, along(p.elbow,p.wrist,.85)], '#faf0d2', 5.7);
    if (rings) {
      // The outer half of the near ring passes in front of the forearm
      // during turnover. Leave the fingers visible around the bottom grip.
      const points = rings[1].points;
      ringLoop(ctx, points.slice(0, (points.length + 1) / 2));
      oval(ctx, p.wrist, 3.1, 2.8, skin);
    }

    ctx.save();
    ctx.translate(...p.head);
    ctx.rotate(Math.atan2(p.head[1] - p.shoulder[1], p.head[0] - p.shoulder[0]) + Math.PI / 2);
    oval(ctx, [0,0], 7.5, 8.4, skin);
    shape(ctx, [[5.6,-3.1],[8.7,1.5],[5.7,2.3]], skin);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(-6.8,4.6);
    ctx.bezierCurveTo(-12,-7,-3.5,-11.6,4.9,-7.5);
    ctx.quadraticCurveTo(7.5,-6.6,6.7,-3.8);
    ctx.quadraticCurveTo(2.5,-4.9,-.2,-3.7);
    ctx.quadraticCurveTo(-2.7,-2.2,-3.0,2);
    ctx.closePath(); ctx.fill();
    oval(ctx, [-2.6,1.3], 1.5, 2.0, '#bf825e');
    oval(ctx, [4.8,-1.8], .8, .8, ink);
    ctx.restore();
  }

  function stage(ctx, motion, p, rings) {
    ctx.fillStyle = '#f0f4ea'; ctx.fillRect(0, 0, 320, 220);
    ctx.fillStyle = '#e3eadd'; ctx.fillRect(0, 202, 320, 18);
    line(ctx, [[0,202],[320,202]], '#afbfac', 1.2);
    oval(ctx, [p.hip[0],205], 29, 2.4, '#cdd8c9');
    const anchor = motion.anchor;
    switch (motion.equipment) {
      case 'rig': {
        const [x,y] = anchor;
        line(ctx, [[x-65,201],[x-65,y-3],[x-61,y-6],[x+4,y-6],[x+4,y]], '#72877a', 4);
        line(ctx, [[x-65,y+20],[x-42,y-6]], '#8d9f90', 2);
        line(ctx, [[x-73,201],[x-57,201]], '#637b6b', 3);
        line(ctx, [[x-5,y],[x+5,y]], ink, 4);
        break;
      }
      case 'rings': {
        const [x, y] = anchor;
        line(ctx, [[x - 46, 201], [x - 46, y - 2], [x + 4, y - 2]], '#819589', 3);
        line(ctx, [[x - 46, y + 15], [x - 29, y - 2]], '#a2b1a4', 2);
        line(ctx, [[x - 52, 201], [x - 40, 201]], '#718578', 3);
        rings.forEach((ring, index) => {
          const far = index === 0, offset = far ? farRingOffset : 0;
          const mount = [ring.mount[0] + offset, ring.mount[1]];
          const top = [ring.top[0] + offset, ring.top[1]];
          line(ctx, [mount, top], far ? '#89978b' : '#41594f', 2.3);
          line(ctx, [along(mount, top, .21), along(mount, top, .27)], '#a3b1a6', 3.3);
          if (far) ringLoop(ctx, ring.points, true);
        });
        break;
      }
      case 'wall':
        ctx.fillStyle = '#d9e2d5'; ctx.fillRect(anchor[0], 18, 9, 184);
        line(ctx, [[anchor[0],18],[anchor[0],202]], '#8d9e90', 2);
        break;
      case 'mat': {
        const [x,y] = anchor;
        ctx.beginPath(); ctx.moveTo(x-17,y);
        ctx.quadraticCurveTo(x+1,y-13,x+17,y); ctx.closePath();
        ctx.fillStyle = '#6c8176'; ctx.fill();
        break;
      }
      case 'box': {
        const [x,y] = anchor;
        shape(ctx, [[x,y],[x+74,y],[x+74,201],[x,201]], '#d6ba8d', '#816e53');
        shape(ctx, [[x,y],[x+74,y],[x+74,y+4],[x,y+4]], '#ecdbbc');
        line(ctx, [[x+8,y+4],[x+8,200]], '#ac926b', 1);
        line(ctx, [[x+34,y+17],[x+46,y+17]], '#8b7558', 3.5);
        break;
      }
      case 'ball': {
        const [x,y] = anchor;
        const wall = x+2;
        line(ctx, [[wall,13],[wall,202]], '#a1b09f', 3);
        line(ctx, [[x,y-9],[x,y+9]], '#8a603b', 5);
        line(ctx, [[x,y-6],[x,y+6]], '#e9ba58', 3);
        break;
      }
      case 'rower': {
        const [x,y] = anchor, fly = [x+50,y-17], railY = y+9;
        line(ctx, [[92,railY],[x+8,railY],[fly[0],fly[1]]], '#647c73', 6);
        line(ctx, [[100,railY],[96,199],[86,199]], '#6c8076', 4);
        line(ctx, [[fly[0],fly[1]+14],[fly[0]+3,199],[fly[0]+15,199]], '#6c8076', 4);
        oval(ctx, fly, 16, 16, '#637c74', ink);
        oval(ctx, fly, 10, 10, '#c2d0c2');
        oval(ctx, fly, 4, 4, '#617970');
        line(ctx, [[x-6,y+6],[x+4,y-8]], ink, 5);
        line(ctx, [[p.hip[0]-7,railY-4],[p.hip[0]+7,railY-4]], ink, 5);
        line(ctx, [[fly[0]-10,fly[1]-1],p.gear], '#879b91', 1.4);
        break;
      }
    }
  }

  function drawRope(ctx, p) {
    const [x,y] = p.wrist, a = p.ropeAngle;
    const height = Math.sin(a) > 0 ? p.toe[1] - y + 4 : Math.max(32,y - p.head[1] + 11);
    const dx = Math.cos(a) * 52, dy = Math.sin(a) * height;
    ctx.strokeStyle = '#ae6d31'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x-4,y);
    ctx.bezierCurveTo(x+dx*.4-3,y+dy*.75,x+dx-5,y+dy,x+dx,y+dy);
    ctx.bezierCurveTo(x+dx+5,y+dy,x+dx*.4+3,y+dy*.75,x+1.5,y);
    ctx.stroke();
    line(ctx, [[x-2,y],[x+2*Math.cos(a),y+2*Math.sin(a)]], ink, 3.5);
  }

  function gear(ctx, motion, p) {
    const equipment = motion.equipment;
    if (motion.id === 'bar-muscle-up') {
      // The near end of the horizontal bar remains in front of the body
      // while the hands roll from below the bar to support above it.
      const [x, y] = motion.anchor;
      line(ctx, [[x + 1, y], [x + 4, y]], ink, 3.2);
      oval(ctx, [x + 4, y], 1.7, 1.7, '#92a69a', ink);
    }
    if (equipment === 'rope') { drawRope(ctx, p); return; }
    if (!p.gear) return;
    const [x,y] = p.gear;
    switch (equipment) {
      case 'barbell':
        // A cutaway plate keeps the rack position and gripping hand visible.
        ctx.save(); ctx.translate(x,y); ctx.scale(.84,1);
        oval(ctx, [-1.2,0], 16.2, 16.2, 'rgba(98,126,112,.22)', ink);
        ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.strokeStyle='#516e60'; ctx.lineWidth=4; ctx.stroke();
        for (let i=0;i<3;i++) {
          ctx.rotate(Math.PI*2/3);
          line(ctx, [[0,-4],[0,-12]], '#637e6f', 2.4);
        }
        oval(ctx, [0,0], 3.8, 3.8, '#cdd8c9', ink);
        ctx.restore(); break;
      case 'kettlebell': {
        const middle = along(p.wrist,p.gear,.5);
        const angle = Math.atan2(y-p.wrist[1], x-p.wrist[0]);
        ctx.save(); ctx.translate(...middle); ctx.rotate(angle);
        const reach = Math.max(4,Math.hypot(x-p.wrist[0], y-p.wrist[1])/2);
        ctx.beginPath(); ctx.moveTo(reach,-5);
        ctx.quadraticCurveTo(-reach-3,-7,-reach,0);
        ctx.quadraticCurveTo(-reach-3,7,reach,5);
        ctx.strokeStyle = ink; ctx.lineWidth = 3.5; ctx.stroke(); ctx.restore();
        oval(ctx, p.gear, 7.8, 7.4, '#536e64', ink);
        oval(ctx, [x-2,y-2], 2.4, 1.5, '#8fa598');
        break;
      }
      case 'ball':
        oval(ctx, p.gear, 7.7, 7.7, '#d3a950', '#6f5c38');
        ctx.beginPath(); ctx.moveTo(x-2,y-7);
        ctx.quadraticCurveTo(x+4,y,x-2,y+7); ctx.strokeStyle='#907237'; ctx.lineWidth=1; ctx.stroke();
        break;
      case 'rower': line(ctx, [[x-1,y-3],[x+2,y+3]], ink, 3.2); break;
    }
  }

  return { stage, athlete, gear };
})();

function drawMovementPose(canvas, motion, pose, regionIds = []) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const cssWidth = canvas.clientWidth || 320;
  const pixelWidth = Math.round(cssWidth * Math.min(window.devicePixelRatio || 1, 3));
  const pixelHeight = Math.round(pixelWidth * 220 / 320);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(pixelWidth / 320, 0, 0, pixelHeight / 220, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const rings = motion.equipment === 'rings'
    ? [-1, 1].map(sign => movementRingGeometry(motion.anchor, pose, sign)) : null;
  movementDrawing.stage(ctx, motion, pose, rings);
  movementDrawing.athlete(ctx, pose, motion, regionIds, rings);
  movementDrawing.gear(ctx, motion, pose);
  return true;
}
