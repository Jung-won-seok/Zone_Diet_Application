// Both kipping variations fit the complete hang and support on the same stage.
// X points forwards and Y down. Angles describe each segment towards the feet.
const ringMountHalfWidth = 22;
const muscleUpMotions = (() => {
  const bar = [160, 66];
  const ringMount = [160, 7];
  const ringReach = 61;
  const frame = (at, label, pose) => ({ at, label, pose });

  function extend(start, length, degrees) {
    const radians = degrees * Math.PI / 180;
    return [start[0] + length * Math.cos(radians), start[1] + length * Math.sin(radians)];
  }

  // Solve for the elbow while the hands stay on the bar or on the moving rings.
  // The same bend direction throughout carries the elbows from below to behind.
  function posture(wrist, shoulderOffset, trunkAngle, thighAngle, shinAngle) {
    const shoulder = [wrist[0] + shoulderOffset[0], wrist[1] + shoulderOffset[1]];
    const dx = wrist[0] - shoulder[0], dy = wrist[1] - shoulder[1];
    const distance = Math.hypot(dx, dy);
    const bend = Math.sqrt(Math.max(0, 18.5 ** 2 - distance ** 2 / 4)) / distance;
    const elbow = [(wrist[0] + shoulder[0]) / 2 - dy * bend, (wrist[1] + shoulder[1]) / 2 + dx * bend];
    const head = extend(shoulder, 12, trunkAngle - 176);
    const hip = extend(shoulder, 33, trunkAngle);
    const knee = extend(hip, 27, thighAngle);
    const ankle = extend(knee, 27, shinAngle);
    const toe = extend(ankle, 8, shinAngle - 24);
    return { head, shoulder, elbow, wrist, hip, knee, ankle, toe };
  }

  const barPose = (...joints) => posture(bar, ...joints);
  const barHang = barPose([0, 37], 90, 88, 92);
  const barArch = barPose([11, 35.3], 100, 104, 124);
  const barHollow = barPose([-12, 35], 73, 63, 73);
  const barLift = barPose([-25, 26], 52, 43, 67);
  const barHighPull = barPose([-30, 10], 38, 43, 64);
  const barTurn = barPose([-24, -5], 67, 62, 82);
  const barOver = barPose([-11, -15], 99, 78, 101);
  const barDip = barPose([4, -17], 140, 94, 119);
  const barPress = barPose([4, -27], 125, 93, 107);
  const barSupport = barPose([4, -Math.sqrt(37 ** 2 - 4 ** 2)], 116, 91, 94);
  const barLower = barPose([-26, 9], 76, 72, 94);

  function ringPose(swingX, halfWidth, yaw, ...joints) {
    // Both overhead attachments remain fixed. Moving the hands closer together
    // or fore/aft changes the vertical drop of the suspension.
    const depthOffset = ringMountHalfWidth - halfWidth;
    const drop = Math.sqrt(ringReach ** 2 - swingX ** 2 - depthOffset ** 2);
    const wrist = [ringMount[0] + swingX, ringMount[1] + drop];
    return { ...posture(wrist, ...joints), ringGripWidth: halfWidth, ringYaw: yaw };
  }

  const ringHang = ringPose(0, 17, 0.32, [0, 37], 90, 88, 92);
  const ringArch = ringPose(10, 17, 0.32, [9.5, 35.75], 98, 102, 125);
  const ringHollow = ringPose(6, 16.5, 0.33, [-14, 34.25], 69, 51, 69);
  const ringDrive = ringPose(4, 16, 0.36, [-28, 22], 45, 35, 61);
  const ringPull = ringPose(-3, 13.8, 0.38, [-27, 4], 39, 33, 58);
  const ringRoll = ringPose(-7, 13, 0.36, [-15, -5], 68, 41, 74);
  const ringTurn = ringPose(-8, 13, 0.35, [-2, -7], 96, 51, 93);
  const ringCatch = ringPose(-8, 13, 0.34, [9, -9], 122, 61, 112);
  const ringDip = ringPose(-7, 13.3, 0.36, [11, -17], 124, 92, 128);
  const ringPress = ringPose(-4, 13.7, 0.45, [6, -28], 111, 90, 107);
  const ringSupport = ringPose(0, 14.5, 0.60, [1, -Math.sqrt(37 ** 2 - 1)], 94, 88, 92);
  const ringLower = ringPose(6, 15.7, 0.34, [-21, 15], 76, 65, 84);

  return {
    'bar-muscle-up': {
      equipment: 'rig', anchor: bar, duration: 5,
      frames: [
        frame(0, '매달리기', barHang), frame(0.55, '아치 스윙', barArch),
        frame(1.05, '할로우 스윙', barHollow), frame(1.39, '엉덩이 끌어올리기', barLift),
        frame(1.64, '엉덩이 끌어올리기', barHighPull), frame(1.82, '가슴을 바 위로 넘기기', barTurn),
        frame(2.01, '가슴을 바 위로 넘기기', barOver), frame(2.22, '가슴을 바 위로 넘기기', barDip),
        frame(2.52, '바 위에서 밀어내기', barPress), frame(2.84, '팔을 펴고 지지하기', barSupport),
        frame(3.27, '팔을 펴고 지지하기', barSupport), frame(3.62, '매달리기로 돌아오기', barDip),
        frame(3.84, '매달리기로 돌아오기', barOver), frame(4.11, '매달리기로 돌아오기', barLower),
        frame(4.47, '매달리기로 돌아오기', barHollow), frame(5, '매달리기로 돌아오기', barHang),
      ],
    },
    'ring-muscle-up': {
      equipment: 'rings', anchor: ringMount, duration: 5.35,
      frames: [
        frame(0, '링에 매달리기', ringHang), frame(0.6, '아치 스윙', ringArch),
        frame(1.15, '할로우 스윙', ringHollow), frame(1.47, '링을 몸 가까이 당기기', ringDrive),
        frame(1.72, '링을 몸 가까이 당기기', ringPull), frame(1.90, '가슴을 링 사이로 넘기기', ringRoll),
        frame(2.03, '가슴을 링 사이로 넘기기', ringTurn), frame(2.16, '가슴을 링 사이로 넘기기', ringCatch),
        frame(2.47, '링 딥으로 밀어내기', ringDip),
        frame(2.75, '링 딥으로 밀어내기', ringPress), frame(3.12, '팔을 펴고 지지하기', ringSupport),
        frame(3.55, '팔을 펴고 지지하기', ringSupport), frame(3.9, '매달리기로 돌아오기', ringDip),
        frame(4.12, '매달리기로 돌아오기', ringCatch), frame(4.23, '매달리기로 돌아오기', ringTurn),
        frame(4.33, '매달리기로 돌아오기', ringRoll),
        frame(4.61, '매달리기로 돌아오기', ringLower), frame(4.89, '매달리기로 돌아오기', ringHollow),
        frame(5.35, '매달리기로 돌아오기', ringHang),
      ],
    },
  };
})();

// Both renderers use the same loop so the lower grip, upper attachment and
// strap stay in contact as the athlete swings and turns the rings.
function movementRingGeometry(anchor, pose, sign) {
  const radius = 7.5;
  const mount = [anchor[0], anchor[1], sign * ringMountHalfWidth];
  const grip = [...pose.wrist, sign * pose.ringGripWidth];
  const strapDirection = mount.map((value, axis) => value - grip[axis]);
  const length = Math.hypot(...strapDirection);
  const up = strapDirection.map(value => value / length);
  const twist = [Math.cos(pose.ringYaw), 0, sign * Math.sin(pose.ringYaw)];
  const slope = twist[0] * up[0] + twist[2] * up[2];
  const transverse = twist.map((value, axis) => value - slope * up[axis]);
  const transverseLength = Math.hypot(...transverse);
  const across = transverse.map(value => value / transverseLength);
  const top = grip.map((value, axis) => value + 2 * radius * up[axis]);
  const sides = 20;
  const points = Array.from({ length: sides + 1 }, (_, i) => {
    if (i === 0 || i === sides) return grip;
    if (i === sides / 2) return top;
    const angle = i * 2 * Math.PI / sides;
    return grip.map((value, axis) => value + radius * (up[axis] * (1 - Math.cos(angle)) + across[axis] * Math.sin(angle)));
  });
  return { mount, grip, top, points };
}
