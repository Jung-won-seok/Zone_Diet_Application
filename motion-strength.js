// Side view, facing right. The floor is y=202; the centre of a grounded plate is y=185.
// The sample times are for the illustration. A frame's label describes the pose at that instant.
const strengthMotions = (() => {
  function stance(knee, hip, shoulder, head, ankle = [150, 197], toe = [165, 202]) {
    return { knee, hip, shoulder, head, ankle, toe };
  }

  const standing = stance([151, 161], [149, 125], [150, 80], [151, 63]);
  const dip = stance([163, 164], [145, 132], [147, 87], [149, 70]);
  const halfSquat = stance([168, 166], [137, 147], [149, 104], [152, 87]);
  const deepSquat = stance([169, 166], [135, 179], [150, 137], [154, 120]);
  const pressing = stance([151, 161], [149, 125], [146, 80], [142, 64]);
  const extension = stance([151, 157], [149, 121], [148, 76], [149, 59], [150, 193]);
  const deadliftStart = stance([155, 161], [120, 151], [160, 130], [172, 117]);
  const cleanStart = stance([159, 162], [123, 157], [160, 132], [171, 119]);
  const snatchStart = stance([161, 163], [125, 161], [164, 139], [175, 126]);
  const atKnee = stance([151, 161], [127, 134], [164, 109], [175, 96]);
  const aboveKnee = stance([151, 161], [130, 131], [163, 101], [172, 87]);
  const powerPosition = stance([157, 162], [139, 130], [158, 89], [164, 73]);

  function hold(body, elbow, wrist) {
    return { ...body, elbow, wrist, gear: wrist };
  }

  // With a wide grip, each arm's side projection is shorter than in a jerk or press.
  function overhead(body, wide = false) {
    const [x, y] = body.shoulder;
    const wrist = [155, y - (wide ? 40 : 51)];
    return hold(body, [(x + wrist[0]) / 2, (y + wrist[1]) / 2], wrist);
  }

  function rack(body) {
    const [x, y] = body.shoulder;
    return hold(body, [x + 22, y + 2], [x + 8, y - 2]);
  }

  function pull(body, barX, barY) {
    const [x, y] = body.shoulder;
    return hold(body, [(x + barX) / 2, (y + barY) / 2], [barX, barY]);
  }

  // The bar clears the face during a press; during an Olympic turnover, the athlete moves under it.
  const pressAtForehead = hold(pressing, [168, 63], [159, 48]);
  const cleanTurnover = hold(halfSquat, [171, 121], [159, 117]);
  const snatchTurnover = hold(dip, [171, 76], [159, 73]);
  const floorPull = pull(deadliftStart, 157, 185);
  const kneePull = pull(atKnee, 156, 162);
  const hang = pull(standing, 156, 134);
  const cleanFloor = pull(cleanStart, 157, 185);
  const cleanExtension = pull(extension, 156, 129);
  const snatchFloor = pull(snatchStart, 157, 185);
  const snatchExtension = pull(extension, 156, 117);

  function frame(at, label, pose) {
    return { at, label, pose };
  }

  function lift(frames) {
    return { equipment: 'barbell', duration: frames[frames.length - 1].at, frames };
  }

  function lowerToRack(at) {
    return [
      frame(at + 0.36, '바벨을 어깨로 내리기', pressAtForehead),
      frame(at + 0.84, '어깨 앞에서 받기', rack(standing)),
    ];
  }

  function lowerToFloor(at, wide = false) {
    return [
      frame(at + 0.30, '바벨을 허벅지로 내리기', hold(dip, [159, 113], [171, 106])),
      frame(at + 0.65, '바벨을 허벅지로 내리기', pull(powerPosition, 156, wide ? 126 : 140)),
      frame(at + 1.12, '무릎 아래로 내리기', pull(atKnee, 156, wide ? 151 : 162)),
      frame(at + 1.68, '바벨을 바닥에 놓기', wide ? snatchFloor : cleanFloor),
    ];
  }

  function lowerSnatch(at) {
    return [
      frame(at + 0.38, '바벨을 허벅지로 내리기', hold(pressing, [170, 69], [162, 56])),
      ...lowerToFloor(at + 0.40, true),
    ];
  }

  // Show both legs throughout this lift so the rear foot can transition continuously into the split.
  function splitStance(pose, rearKnee, rearAnkle, rearToe) {
    const behind = ([x, y]) => [x - 4, y];
    return { ...pose, rearKnee: rearKnee || behind(pose.knee),
      rearAnkle: rearAnkle || behind(pose.ankle), rearToe: rearToe || behind(pose.toe) };
  }
  const split = stance([180, 163], [149, 145], [149, 100], [151, 83], [183, 197], [198, 202]);
  const splitStep = stance([165, 161], [145, 132], [148, 87], [150, 70], [166, 197], [181, 202]);

  return {
    'front-squat': lift([
      frame(0, '어깨 앞에 바벨 받치기', rack(standing)),
      frame(1.1, '무릎과 엉덩이 굽히기', rack(halfSquat)),
      frame(2.0, '깊이 앉기', rack(deepSquat)),
      frame(3.1, '팔꿈치를 들고 일어나기', rack(halfSquat)),
      frame(4.0, '무릎과 엉덩이 펴기', rack(standing)),
    ]),
    'overhead-squat': lift([
      frame(0, '바벨을 머리 위에 고정하기', overhead(standing, true)),
      frame(1.1, '팔을 편 채 내려가기', overhead(halfSquat, true)),
      frame(2.0, '바벨 아래 깊이 앉기', overhead(deepSquat, true)),
      frame(3.1, '바벨을 지지하며 일어나기', overhead(halfSquat, true)),
      frame(4.0, '선 자세로 마무리하기', overhead(standing, true)),
    ]),
    thruster: lift([
      frame(0, '어깨 앞에 바벨 받치기', rack(standing)),
      frame(0.9, '바벨과 함께 내려가기', rack(halfSquat)),
      frame(1.6, '프런트 스쿼트 바닥 자세', rack(deepSquat)),
      frame(2.2, '다리로 바닥 밀기', rack(halfSquat)),
      frame(2.7, '일어서며 바벨 띄우기', rack(standing)),
      frame(3.1, '얼굴 앞으로 바벨 밀기', pressAtForehead),
      frame(3.6, '머리 위에서 팔 펴기', overhead(standing)),
      ...lowerToRack(3.6),
    ]),
    deadlift: lift([
      frame(0, '바닥의 바벨 잡기', floorPull),
      frame(1.0, '몸 가까이 무릎까지 들기', kneePull),
      frame(1.5, '무릎 위로 바벨 통과', pull(powerPosition, 157, 142)),
      frame(2.2, '허벅지 앞에서 일어서기', hang),
      frame(3.1, '엉덩이를 접어 내리기', kneePull),
      frame(4.0, '바벨을 바닥에 놓기', floorPull),
    ]),
    'push-press': lift([
      frame(0, '어깨 앞에서 준비하기', rack(standing)),
      frame(0.7, '몸통을 세워 얕게 앉기', rack(dip)),
      frame(1.1, '다리를 펴며 바벨 띄우기', rack(standing)),
      frame(1.5, '선 채 바벨 밀어 올리기', pressAtForehead),
      frame(2.1, '머리 위에서 팔 펴기', overhead(standing)),
      ...lowerToRack(2.1),
    ]),
    'push-jerk': lift([
      frame(0, '어깨 앞에서 준비하기', rack(standing)),
      frame(0.6, '무릎 살짝 굽히기', rack(dip)),
      frame(1.0, '다리로 바벨 띄우기', rack(extension)),
      frame(1.3, '바벨 아래로 들어가기', hold(dip, [169, 79], [159, 62])),
      frame(1.6, '무릎을 굽혀 머리 위로 받기', overhead(halfSquat)),
      frame(2.5, '팔을 편 채 일어서기', overhead(standing)),
      ...lowerToRack(2.5),
    ]),
    'power-clean': lift([
      frame(0, '바닥에서 준비하기', cleanFloor),
      frame(0.9, '무릎을 지나 당기기', pull(aboveKnee, 156, 154)),
      frame(1.4, '엉덩이와 다리 펴기', cleanExtension),
      frame(1.7, '팔꿈치를 바 아래로 돌리기', cleanTurnover),
      frame(2.0, '얕게 앉아 어깨에 받기', rack(halfSquat)),
      frame(2.9, '어깨에 받치고 서기', rack(standing)),
      ...lowerToFloor(2.9),
    ]),
    'power-snatch': lift([
      frame(0, '넓게 잡고 준비하기', snatchFloor),
      frame(0.9, '무릎을 지나 당기기', pull(atKnee, 156, 151)),
      frame(1.4, '엉덩이와 다리 펴기', snatchExtension),
      frame(1.7, '바 아래로 팔 돌리기', snatchTurnover),
      frame(2.0, '얕게 앉아 머리 위로 받기', overhead(halfSquat, true)),
      frame(2.9, '머리 위에 지지하고 서기', overhead(standing, true)),
      ...lowerSnatch(2.9),
    ]),
    snatch: lift([
      frame(0, '넓게 잡고 준비하기', snatchFloor),
      frame(0.9, '무릎을 지나 당기기', pull(atKnee, 156, 151)),
      frame(1.4, '다리와 엉덩이 펴기', snatchExtension),
      frame(1.7, '몸을 바 아래로 낮추기', hold(halfSquat, [172, 99], [159, 92])),
      frame(2.1, '깊이 앉아 머리 위로 받기', overhead(deepSquat, true)),
      frame(2.9, '팔을 편 채 일어나기', overhead(halfSquat, true)),
      frame(3.6, '머리 위에 지지하고 서기', overhead(standing, true)),
      ...lowerSnatch(3.6),
    ]),
    'clean-and-jerk': lift([
      frame(0, '바닥에서 준비하기', splitStance(cleanFloor)),
      frame(0.8, '무릎을 지나 당기기', splitStance(pull(aboveKnee, 156, 154))),
      frame(1.3, '다리와 엉덩이 펴기', splitStance(cleanExtension)),
      frame(1.6, '팔꿈치를 바 아래로 돌리기', splitStance(cleanTurnover)),
      frame(2.0, '깊이 앉아 어깨에 받기', splitStance(rack(deepSquat))),
      frame(2.9, '어깨에 받치고 서기', splitStance(rack(standing))),
      frame(3.6, '저크를 위해 얕게 앉기', splitStance(rack(dip))),
      frame(4.0, '바벨을 위로 띄우기', splitStance(rack(extension))),
      frame(4.5, '앞뒤로 발을 벌려 받기', splitStance(overhead(split), [124, 172], [99, 193], [109, 202])),
      frame(5.1, '앞발을 중앙으로 옮기기', splitStance(overhead(splitStep), [122, 160], [106, 191], [117, 202])),
      frame(5.8, '양발을 모아 서기', splitStance(overhead(standing))),
      ...[...lowerToRack(5.8), ...lowerToFloor(6.64)].map(f => frame(f.at, f.label, splitStance(f.pose))),
    ]),
  };
})();
