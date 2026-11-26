const equipmentMotions = (() => {
  // Side view: x points right, y points down. Angles start at the right and
  // turn clockwise. Segment lengths stay fixed when constructing each pose.
  function extend([x, y], length, degrees) {
    const angle = degrees * Math.PI / 180;
    return [x + length * Math.cos(angle), y + length * Math.sin(angle)];
  }

  function upperBody(hip, torsoAngle, [upperArm, forearm]) {
    const shoulder = extend(hip, 35, torsoAngle);
    const head = extend(shoulder, 14, (torsoAngle - 90) / 2);
    const elbow = extend(shoulder, 21, upperArm);
    return { hip, shoulder, head, elbow, wrist: extend(elbow, 21, forearm) };
  }

  // Angles follow ankle → knee → hip → shoulder, then shoulder → elbow → wrist.
  function fromFeet(ankle, [shin, thigh, torso], arms, toeOffset = [14, 7]) {
    const knee = extend(ankle, 29, shin);
    const hip = extend(knee, 31, thigh);
    const toe = [ankle[0] + toeOffset[0], ankle[1] + toeOffset[1]];
    return { ankle, knee, toe, ...upperBody(hip, torso, arms) };
  }

  function frame(at, label, pose) { return { at, label, pose }; }
  const standing = [-88, -94, -88];
  const rackArms = [62, -67];
  const ballTarget = [226, 33];

  function wallBall(legs, arms, flyingBall) {
    const pose = fromFeet([150, 195], legs, arms);
    // The palm touches the lower-left edge until release and again at the catch.
    pose.gear = flyingBall || [pose.wrist[0] + 5, pose.wrist[1] - 6];
    return pose;
  }

  function swing(legs, armAngle) {
    const pose = fromFeet([150, 195], legs, [armAngle, armAngle]);
    // The bell body changes orientation around its handle with the swing.
    pose.gear = extend(pose.wrist, 11, armAngle);
    return pose;
  }

  function jumpRope(ankleY, legs, toeDrop, turns) {
    return {
      ...fromFeet([153, ankleY], legs, [104, 39], [11, toeDrop]),
      ropeAngle: turns * 2 * Math.PI,
    };
  }

  function rowing(seatX, torsoAngle, arms) {
    const ankle = [219, 159], hip = [seatX, 159];
    // Solve a two-link leg over the seat rail; the strapped foot stays put
    // as the hip travels and both leg segments retain their length.
    const span = ankle[0] - seatX;
    const thighX = (31 * 31 - 29 * 29 + span * span) / (2 * span);
    const knee = [seatX + thighX, hip[1] - Math.sqrt(31 * 31 - thighX * thighX)];
    const pose = { ankle, knee, toe: [227, 148], ...upperBody(hip, torsoAngle, arms) };
    pose.gear = pose.wrist;
    return pose;
  }

  return {
    'box-jump': {
      duration: 2, equipment: 'box', anchor: [174, 153],
      frames: [
        frame(0, '박스 앞에 서기', fromFeet([126, 195], standing, [85, 80])),
        frame(0.38, '팔을 뒤로 보내기', fromFeet([126, 195], [-68, -142, -57], [115, 145])),
        frame(0.46, '두 발로 도약', fromFeet([126, 195], [-77, -124, -64], [76, 76])),
        frame(0.55, '두 발로 도약', fromFeet([128, 190], [-80, -100, -72], [40, 8], [12, 12])),
        frame(0.63, '두 발로 도약', fromFeet([136, 176], [-79, -111, -70], [0, -20], [12, 11])),
        frame(0.72, '두 발로 도약', fromFeet([146, 159], [-78, -124, -68], [-35, -52], [12, 9])),
        frame(0.91, '발을 박스 위로', fromFeet([170, 132], [-78, 177, -68], [-27, -42], [14, 7])),
        frame(1.08, '발을 박스 위로', fromFeet([189, 136], [-73, -164, -66], [0, -20])),
        frame(1.23, '박스 위에 착지', fromFeet([200, 146], [-70, -134, -67], [26, -5])),
        frame(1.38, '박스 위에 착지', fromFeet([200, 146], [-65, -154, -61], [25, -10])),
        frame(1.66, '박스 위에서 일어서기', fromFeet([200, 146], [-77, -120, -75], [53, 35])),
        frame(2, '박스 위에서 일어서기', fromFeet([200, 146], standing, [85, 80])),
      ],
    },
    'double-under': {
      duration: 1.46, equipment: 'rope',
      // From takeoff (0 turns) to touchdown (2 turns), the rope tip passes
      // below the shoes at exactly 1/4 and 1 1/4 turns in this side view.
      frames: [
        frame(0, '줄 돌릴 준비', jumpRope(195, standing, 7, -0.25)),
        frame(0.2, '무릎 굽히기', jumpRope(195, [-78, -112, -85], 7, -0.1)),
        frame(0.32, '두 발로 도약', jumpRope(190, standing, 12, 0)),
        frame(0.42, '첫 번째 줄 통과', jumpRope(177, standing, 13, 0.25)),
        frame(0.52, '첫 번째 줄 통과', jumpRope(166, standing, 13, 0.5)),
        frame(0.72, '두 번째 회전', jumpRope(158, standing, 13, 1)),
        frame(0.82, '두 번째 줄 통과', jumpRope(160, standing, 13, 1.25)),
        frame(0.92, '두 번째 줄 통과', jumpRope(166, standing, 13, 1.5)),
        frame(1.02, '착지 준비', jumpRope(177, standing, 13, 1.75)),
        frame(1.12, '두 발로 착지', jumpRope(190, standing, 12, 2)),
        frame(1.28, '두 발로 착지', jumpRope(195, [-78, -113, -85], 7, 2.07)),
        frame(1.46, '다음 점프 준비', jumpRope(195, standing, 7, 2.12)),
      ],
    },
    'wall-ball': {
      duration: 2.9, equipment: 'ball', anchor: ballTarget,
      frames: [
        frame(0, '공을 가슴 앞에 받치기', wallBall(standing, rackArms)),
        frame(0.33, '스쿼트', wallBall([-74, -139, -78], rackArms)),
        frame(0.65, '스쿼트', wallBall([-63, 174, -69], rackArms)),
        frame(0.98, '일어서며 밀기', wallBall([-74, -129, -80], [50, -65])),
        frame(1.13, '일어서며 밀기', wallBall(standing, [28, -95])),
        frame(1.19, '일어서며 밀기', wallBall(standing, [-8, -73])),
        frame(1.24, '공 놓기', wallBall(standing, [-45, -53])),
        frame(1.40, '공이 표적으로', wallBall(standing, [-52, -56], [201, 38])),
        frame(1.57, '표적에 닿기', wallBall(standing, [-57, -62], [ballTarget[0] - 7, ballTarget[1]])),
        frame(1.75, '공 내려오기', wallBall(standing, [-44, -62], [205, 40])),
        frame(1.92, '공 내려오기', wallBall(standing, [-35, -65], [188, 59])),
        frame(2.03, '공 받아내기', wallBall(standing, [-24, -66])),
        frame(2.16, '공 받아내기', wallBall([-81, -111, -81], [20, -83])),
        frame(2.32, '공 받아내기', wallBall([-76, -125, -76], rackArms)),
        frame(2.9, '다음 스쿼트', wallBall([-63, 174, -69], rackArms)),
      ],
    },
    'kettlebell-swing': {
      duration: 2.2, equipment: 'kettlebell',
      frames: [
        frame(0, '다리 사이로 보내기', swing([-80, -145, -45], 116)),
        frame(0.30, '엉덩이 펴기', swing([-83, -116, -65], 85)),
        frame(0.53, '앞으로 스윙', swing(standing, 41)),
        frame(0.73, '앞으로 스윙', swing(standing, -5)),
        frame(0.91, '머리 위로', swing(standing, -46)),
        frame(1.10, '머리 위로', swing(standing, -89)),
        frame(1.37, '앞으로 내리기', swing(standing, -46)),
        frame(1.58, '앞으로 내리기', swing(standing, -3)),
        frame(1.78, '앞으로 내리기', swing(standing, 43)),
        frame(1.99, '다리 사이로 보내기', swing([-82, -116, -65], 85)),
        frame(2.2, '다리 사이로 보내기', swing([-80, -145, -45], 116)),
      ],
    },
    row: {
      duration: 2.6, equipment: 'rower', anchor: [219, 160],
      frames: [
        frame(0, '캐치', rowing(196, -70, [9, 9])),
        frame(0.40, '다리로 밀기', rowing(171, -70, [9, 9])),
        frame(0.65, '몸통 뒤로 열기', rowing(160, -88, [7, 7])),
        frame(0.82, '팔로 당기기', rowing(160, -105, [47, -5])),
        frame(0.91, '팔로 당기기', rowing(160, -105, [94, -13])),
        frame(1.00, '피니시', rowing(160, -105, [139, 1])),
        frame(1.18, '팔 먼저 펴기', rowing(160, -105, [99, -12])),
        frame(1.32, '팔 먼저 펴기', rowing(160, -105, [57, -8])),
        frame(1.52, '팔 먼저 펴기', rowing(160, -105, [8, 8])),
        frame(1.81, '몸통 앞으로', rowing(160, -70, [9, 9])),
        frame(2.23, '무릎 접기', rowing(179, -70, [9, 9])),
        frame(2.6, '캐치', rowing(196, -70, [9, 9])),
      ],
    },
  };
})();
