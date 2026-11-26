const movementMotions = Object.fromEntries(
  Object.entries({ ...strengthMotions, ...bodyweightMotions, ...equipmentMotions, ...muscleUpMotions })
    .map(([id, motion]) => [id, { id, ...motion }])
);

function getMovementMotion(id) {
  return Object.hasOwn(movementMotions, id) ? movementMotions[id] : null;
}

// A monotone cubic keeps a planted hand or foot fixed across a hold, and
// rounds off a change of direction without shooting past the bar or floor.
function motionTangent(leftRate, rightRate, leftSpan, rightSpan) {
  if (leftRate * rightRate <= 0) return 0;
  const a = 2 * rightSpan + leftSpan, b = rightSpan + 2 * leftSpan;
  return (a + b) / (a / leftRate + b / rightRate);
}

function segmentLength(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function bendSide(start, joint, end) {
  const cross = (end[0] - start[0]) * (joint[1] - start[1]) - (end[1] - start[1]) * (joint[0] - start[0]);
  return Math.abs(cross) < 0.01 ? 0 : Math.sign(cross);
}

// Interpolating an elbow directly from below the shoulder to above it can make
// the forearm vanish midway. Solve the two limb segments around their endpoints:
// the hand still follows its bar and a planted foot still stays on the floor.
function sampleBend(pose, first, last, u, root, joint, tip) {
  const from = pose[root], to = pose[tip], distance = segmentLength(from, to);
  if (distance < 0.01) return;
  const upper = (1 - u) * segmentLength(first[root], first[joint]) + u * segmentLength(last[root], last[joint]);
  const lower = (1 - u) * segmentLength(first[joint], first[tip]) + u * segmentLength(last[joint], last[tip]);
  const startSide = bendSide(first[root], first[joint], first[tip]);
  const endSide = bendSide(last[root], last[joint], last[tip]);
  // A rotation in or out of the side-view plane can change which side the
  // joint projects onto. Blend through the limb's axis at those transitions.
  const side = (1 - u) * (startSide || endSide) + u * (endSide || startSide);
  const along = Math.max(-upper, Math.min(upper, (upper * upper - lower * lower + distance * distance) / (2 * distance)));
  const height = side * Math.sqrt(Math.max(0, upper * upper - along * along));
  const dx = (to[0] - from[0]) / distance, dy = (to[1] - from[1]) / distance;
  // Very close to a keyframe the cubic joint path has the velocity of both
  // adjacent segments. Ease in the length correction, which can otherwise
  // snap a straight knee or elbow into a bend at the start of a new loop.
  const edge = Math.min(1, u * 8, (1 - u) * 8);
  const weight = edge * edge * (3 - 2 * edge);
  const [x, y] = pose[joint];
  pose[joint] = [x + weight * (from[0] + dx * along - dy * height - x),
    y + weight * (from[1] + dy * along + dx * height - y)];
}

function sampleMovementPose(motion, seconds) {
  const frames = motion.frames;
  const time = Math.max(0, Math.min(motion.duration, Number(seconds) || 0));
  let i = 0;
  while (i + 1 < frames.length && frames[i + 1].at <= time) i++;
  const start = frames[i], end = frames[i + 1];
  if (!end || time === start.at) return { phaseIndex: i, pose: start.pose };

  // The end pose is the start pose one cycle later. Its neighbors on either
  // side therefore contribute to the same tangent, even on the first play.
  const firstSegment = i === 0, lastSegment = i === frames.length - 2;
  const prev = firstSegment ? frames[frames.length - 2] : frames[i - 1];
  const next = lastSegment ? frames[1] : frames[i + 2];
  const prevSpan = start.at - prev.at + (firstSegment ? motion.duration : 0);
  const nextSpan = next.at - end.at + (lastSegment ? motion.duration : 0);
  const span = end.at - start.at, u = (time - start.at) / span;
  const u2 = u * u, u3 = u2 * u;
  function between(a, b, p, n) {
    if (a === b) return a;
    const rate = (b - a) / span;
    const left = motionTangent((a - p) / prevSpan, rate, prevSpan, span);
    const right = motionTangent(rate, (n - b) / nextSpan, span, nextSpan);
    return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * span * left +
      (3 * u2 - 2 * u3) * b + (u3 - u2) * span * right;
  }

  const pose = {};
  for (const [key, a] of Object.entries(start.pose)) {
    const b = end.pose[key];
    if (Array.isArray(a)) {
      pose[key] = a.map((value, axis) => between(value, b[axis], prev.pose[key][axis], next.pose[key][axis]));
    } else {
      // The double-under is authored with increasing, unwrapped rope angles.
      const winding = key === 'ropeAngle' ? frames[frames.length - 1].pose[key] - frames[0].pose[key] : 0;
      pose[key] = between(a, b, prev.pose[key] - (firstSegment ? winding : 0),
        next.pose[key] + (lastSegment ? winding : 0));
    }
  }
  sampleBend(pose, start.pose, end.pose, u, 'shoulder', 'elbow', 'wrist');
  sampleBend(pose, start.pose, end.pose, u, 'hip', 'knee', 'ankle');
  if (pose.rearKnee) sampleBend(pose, start.pose, end.pose, u, 'hip', 'rearKnee', 'rearAnkle');
  return { phaseIndex: i, pose };
}
