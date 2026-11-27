// Side-view keyframes in stage coordinates. Angles run clockwise from horizontal.
const bodyweightMotions = (() => {
  function along(point, length, angle) {
    const radians = angle * Math.PI / 180;
    return [point[0] + length * Math.cos(radians), point[1] + length * Math.sin(radians)];
  }

  // Place an elbow or knee between two authored contacts without shifting a hand or foot.
  function bentJoint(start, end, segment, side) {
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const distance = Math.hypot(dx, dy);
    const bend = side * Math.sqrt(Math.max(0, segment ** 2 - distance ** 2 / 4));
    return [(start[0] + end[0]) / 2 - dy * bend / distance,
      (start[1] + end[1]) / 2 + dx * bend / distance];
  }

  function pose({ hip, torso, headAngle = torso, wrist, ankle, toe,
    armSide = 1, legSide = -1, knee = bentJoint(hip, ankle, 33, legSide) }) {
    const shoulder = along(hip, 41, torso);
    return { head: along(shoulder, 14, headAngle), shoulder, elbow: bentJoint(shoulder, wrist, 23, armSide),
      wrist, hip, knee, ankle, toe };
  }

  const frame = (at, label, pose) => ({ at, label, pose });
  const grip = [159, 31];
  const hang = pose({ hip: [158, 118], torso: -89, wrist: grip, ankle: [158, 184], toe: [170, 190] });
  const arch = pose({ hip: [166, 113], torso: -79, wrist: grip, ankle: [139, 172], toe: [145, 182] });
  const hollow = pose({ hip: [149, 114], torso: -102, wrist: grip, ankle: [177, 172], toe: [188, 178] });
  const tuck = pose({ hip: [145, 104], torso: -111, wrist: grip, ankle: [192, 119], toe: [204, 113] });
  const unfolding = pose({ hip: [145, 101], torso: -116, wrist: grip, ankle: [198, 66], toe: [202, 54] });
  const barTouch = pose({ hip: [149, 99], torso: -118.5, wrist: grip, ankle: [166, 36], toe: grip });
  const feetAway = pose({ hip: [146, 101], torso: -115, wrist: grip, ankle: [204, 91], toe: [212, 82] });
  const riseToBar = pose({ hip: [150, 92], torso: -106, wrist: grip, ankle: [171, 154], toe: [182, 160] });
  const chinOverBar = pose({ hip: [150, 74], torso: -97, headAngle: -80, wrist: grip, ankle: [155, 139], toe: [167, 145] });

  const ankle = [150, 195], toe = [165, 202];
  const standing = pose({ hip: [150, 129], torso: -88, wrist: [154, 133], ankle, toe });
  const halfSquat = pose({ hip: [141, 149], torso: -74, wrist: [188, 120], ankle, toe });
  const deepSquat = pose({ hip: [133, 171], torso: -65, wrist: [190, 117], ankle, toe });

  const pushHand = [174, 201], pushToe = [85, 202];
  function pushUp(angle) {
    const ankle = [86, 188];
    return pose({ hip: along(ankle, 66, angle), torso: angle, headAngle: angle - 8,
      wrist: pushHand, knee: along(ankle, 33, angle), ankle, toe: pushToe });
  }
  const plank = pushUp(-16.5), lowPlank = pushUp(1.5);
  const palmsDown = pose({ hip: [149, 168], torso: -12, headAngle: -18, wrist: pushHand, ankle, toe });
  const feetMoving = pose({ hip: [140, 149], torso: 10, wrist: pushHand,
    ankle: [108, 182], toe: [114, 193] });
  const prone = pose({ hip: [150, 195], torso: -4, headAngle: -21, wrist: pushHand,
    knee: [117, 196], ankle: [84, 194], toe: pushToe });
  const jumpSet = pose({ hip: [143, 148], torso: -68, wrist: [130, 139], ankle, toe });
  const lowSwing = pose({ hip: [146, 137], torso: -78, wrist: [171, 138], ankle, toe });
  const forwardSwing = pose({ hip: [148, 132], torso: -84, wrist: [195, 98], ankle, toe });
  const takeoff = pose({ hip: [149, 126], torso: -88, wrist: [178, 53],
    ankle: [149, 192], toe: [161, 201] });
  const airborne = pose({ hip: [148, 109], torso: -87, wrist: [155, 23],
    ankle: [148, 175], toe: [158, 186] });
  const descend = pose({ hip: [148, 118], torso: -81, wrist: [195, 65],
    ankle: [149, 183], toe: [161, 192] });
  const absorbLanding = pose({ hip: [143, 148], torso: -68, wrist: [178, 148], ankle, toe });

  function sitUp(torso, wrist, headAngle) {
    // The knees open sideways in the butterfly position, foreshortening the thigh in profile.
    return pose({ hip: [151, 193], torso, headAngle, wrist, armSide: -1,
      knee: [169, 182], ankle: [186, 197], toe: [197, 199] });
  }
  const lying = sitUp(-175, [65, 197], -174);
  const armsForward = sitUp(-153, [111, 130], -133);
  const sittingUp = sitUp(-111, [176, 129], -96);
  const seated = sitUp(-59, [191, 199], -82);

  const wall = [180, 202], floorHand = [153, 201];
  function inverted(hipY, torso, headAngle) {
    const hip = [163, hipY], ankle = [178, hipY - 64];
    return pose({ hip, torso, headAngle, wrist: floorHand, armSide: -1,
      knee: [170.5, hipY - 32], ankle, toe: [164, ankle[1] - 4] });
  }
  const invertedLockout = inverted(115, 103, 105);
  const invertedHalf = inverted(127, 109, 111);
  const headToFloor = inverted(141, 108, 113);

  return {
    'toes-to-bar': { duration: 3, equipment: 'rig', anchor: grip, frames: [
      frame(0, '매달리기', hang), frame(0.5, '발을 뒤로 보내기', arch),
      frame(0.95, '가슴을 뒤로 보내기', hollow), frame(1.35, '무릎 끌어올리기', tuck),
      frame(1.49, '다리 펴기', unfolding), frame(1.65, '발끝을 바에 대기', barTouch),
      frame(1.83, '발을 앞으로 내리기', unfolding), frame(2.05, '발을 앞으로 내리기', feetAway),
      frame(2.55, '다리 내리기', hollow), frame(3, '다시 매달리기', hang)]
    },
    'pull-up': { duration: 2.8, equipment: 'rig', anchor: grip, frames: [
      frame(0, '매달리기', hang), frame(0.45, '가슴을 앞으로 보내기', arch),
      frame(0.9, '다리를 앞으로 보내기', hollow), frame(1.25, '몸 당기기', riseToBar),
      frame(1.55, '턱이 바 위로', chinOverBar), frame(1.95, '바에서 밀어내기', riseToBar),
      frame(2.35, '팔 펴기', hollow), frame(2.8, '다시 매달리기', hang)]
    },
    'push-up': { duration: 2.4, equipment: 'none', frames: [
      frame(0, '팔을 편 플랭크', plank), frame(0.55, '몸통 내리기', pushUp(-8)),
      frame(1.2, '가슴을 바닥 가까이', lowPlank), frame(1.8, '바닥 밀기', pushUp(-8)),
      frame(2.4, '팔 펴기', plank)]
    },
    'air-squat': { duration: 2.8, equipment: 'none', frames: [
      frame(0, '서서 준비', standing), frame(0.75, '무릎과 엉덩이 굽히기', halfSquat),
      frame(1.45, '깊이 앉기', deepSquat), frame(2.05, '일어서기', halfSquat),
      frame(2.8, '무릎과 엉덩이 펴기', standing)]
    },
    burpee: { duration: 4.4, equipment: 'none', frames: [
      frame(0, '서서 준비', standing), frame(0.55, '손 짚기', palmsDown),
      frame(0.8, '발을 뒤로 보내기', feetMoving), frame(1.05, '플랭크', plank),
      frame(1.5, '가슴과 허벅지를 바닥에', prone), frame(1.95, '바닥 밀기', plank),
      frame(2.25, '발을 앞으로 모으기', feetMoving), frame(2.5, '손 옆으로 착지', palmsDown),
      frame(2.9, '손 떼고 일어나기', jumpSet), frame(3.02, '팔을 앞으로 휘두르기', lowSwing),
      frame(3.13, '팔을 앞으로 휘두르기', forwardSwing), frame(3.25, '바닥을 차고 오르기', takeoff),
      frame(3.55, '점프하며 손 올리기', airborne), frame(3.74, '팔 내리기', descend),
      frame(3.9, '무릎 굽혀 착지', absorbLanding),
      frame(4.4, '다시 서기', standing)]
    },
    'sit-up': { duration: 3.2, equipment: 'mat', anchor: [140, 202], frames: [
      frame(0, '등 대고 눕기', lying), frame(0.55, '팔 앞으로 보내기', armsForward),
      frame(1, '상체 일으키기', sittingUp), frame(1.55, '발 쪽으로 손 뻗기', seated),
      frame(2.1, '상체 내리기', sittingUp), frame(2.65, '등 대기', armsForward),
      frame(3.2, '다시 눕기', lying)]
    },
    'handstand-push-up': { duration: 2.8, equipment: 'wall', anchor: wall, frames: [
      frame(0, '벽에 기대어 물구나무', invertedLockout), frame(0.7, '팔 굽히기', invertedHalf),
      frame(1.4, '머리를 바닥에 대기', headToFloor), frame(2.05, '바닥 밀기', invertedHalf),
      frame(2.8, '팔 펴기', invertedLockout)]
    }
  };
})();
