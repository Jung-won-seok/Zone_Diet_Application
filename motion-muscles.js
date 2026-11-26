const movementMuscleLabels = Object.freeze({
  quads: '허벅지 앞', hamstrings: '허벅지 뒤', glutes: '엉덩이', calves: '종아리',
  core: '복부', hipFlexors: '고관절 앞', back: '등', chest: '가슴', shoulders: '어깨',
  biceps: '위팔 앞', triceps: '위팔 뒤', forearms: '아래팔',
});

// Regions highlight the muscles producing or controlling the illustrated motion,
// including postural support during holds. They do not encode activation intensity.
// Keying by stage name keeps a new interpolation frame from shifting later cues.
const movementStageMuscles = (() => {
  const squat = ['quads', 'glutes'];
  const hinge = ['glutes', 'hamstrings'];
  const jump = ['quads', 'glutes', 'calves'];
  const frontRack = ['core', 'back'];
  const overhead = ['shoulders', 'triceps', 'core'];
  const overheadSquat = ['quads', 'glutes', 'shoulders'];
  const press = ['shoulders', 'triceps'];
  const plank = ['core', 'shoulders'];
  const pushUp = ['chest', 'triceps', 'shoulders'];
  const hang = ['forearms', 'back'];
  const pull = ['back', 'biceps'];
  const raiseLegs = ['core', 'hipFlexors'];
  // The muscle-up moves from pulling to a dip and then supported elbow extension.
  // https://pmc.ncbi.nlm.nih.gov/articles/PMC10824315/
  const dip = ['chest', 'triceps', 'shoulders'];
  const muscleUpStages = {
    '아치 스윙': ['glutes', 'back'], '할로우 스윙': ['core', 'back'],
    '팔을 펴고 지지하기': ['triceps', 'shoulders', 'core'], '매달리기로 돌아오기': ['back', 'forearms'],
  };

  // https://www.nsca.com/globalassets/about/position-statements/weighlifting-for-sports-performance.pdf
  // https://www.crossfit.com/essentials/the-thruster
  const liftFromFloor = {
    '무릎을 지나 당기기': ['quads', 'glutes'],
    '엉덩이와 다리 펴기': jump,
    '다리와 엉덩이 펴기': jump,
  };
  const clean = {
    ...liftFromFloor,
    '바닥에서 준비하기': ['core', 'quads'],
    '팔꿈치를 바 아래로 돌리기': ['back', 'shoulders'],
    '얕게 앉아 어깨에 받기': ['quads', 'core'],
    '깊이 앉아 어깨에 받기': ['quads', 'glutes', 'core'],
    '어깨에 받치고 서기': squat,
  };
  const snatch = {
    ...liftFromFloor,
    '넓게 잡고 준비하기': ['core', 'quads'],
    '바 아래로 팔 돌리기': ['back', 'shoulders'],
    '몸을 바 아래로 낮추기': ['back', 'shoulders'],
    '얕게 앉아 머리 위로 받기': overheadSquat,
    '깊이 앉아 머리 위로 받기': overheadSquat,
    '팔을 편 채 일어나기': overheadSquat,
    '머리 위에 지지하고 서기': overhead,
  };
  return {
    'front-squat': {
      '어깨 앞에 바벨 받치기': frontRack, '무릎과 엉덩이 굽히기': squat,
      '깊이 앉기': squat, '팔꿈치를 들고 일어나기': squat, '무릎과 엉덩이 펴기': squat,
    },
    'overhead-squat': {
      '바벨을 머리 위에 고정하기': overhead, '팔을 편 채 내려가기': overheadSquat,
      '바벨 아래 깊이 앉기': overheadSquat, '바벨을 지지하며 일어나기': overheadSquat,
      '선 자세로 마무리하기': overhead,
    },
    thruster: {
      '어깨 앞에 바벨 받치기': frontRack, '바벨과 함께 내려가기': squat,
      '프런트 스쿼트 바닥 자세': squat, '다리로 바닥 밀기': squat,
      '일어서며 바벨 띄우기': ['quads', 'glutes', 'shoulders'],
      '얼굴 앞으로 바벨 밀기': press, '머리 위에서 팔 펴기': overhead,
    },
    deadlift: {
      '바닥의 바벨 잡기': ['core', 'forearms'],
      '몸 가까이 무릎까지 들기': ['quads', 'glutes', 'hamstrings'],
      '무릎 위로 바벨 통과': hinge, '허벅지 앞에서 일어서기': hinge,
      '엉덩이를 접어 내리기': hinge, '바벨을 바닥에 놓기': ['quads', 'glutes', 'hamstrings'],
    },
    'push-press': {
      '어깨 앞에서 준비하기': frontRack, '몸통을 세워 얕게 앉기': squat,
      '다리를 펴며 바벨 띄우기': squat, '선 채 바벨 밀어 올리기': press,
      '머리 위에서 팔 펴기': overhead,
    },
    'push-jerk': {
      '어깨 앞에서 준비하기': frontRack, '무릎 살짝 굽히기': squat, '다리로 바벨 띄우기': jump,
      '바벨 아래로 들어가기': press, '무릎을 굽혀 머리 위로 받기': overheadSquat,
      '팔을 편 채 일어서기': overheadSquat,
    },
    'power-clean': clean,
    'power-snatch': snatch,
    snatch,
    'clean-and-jerk': {
      ...clean, '저크를 위해 얕게 앉기': squat, '바벨을 위로 띄우기': jump,
      '앞뒤로 발을 벌려 받기': overheadSquat, '앞발을 중앙으로 옮기기': overheadSquat,
      '양발을 모아 서기': overhead,
    },
    // https://www.crossfit.com/essentials/crossfit-toes-to-bar-rx-plan
    'toes-to-bar': {
      '매달리기': hang, '발을 뒤로 보내기': ['glutes', 'back'],
      '가슴을 뒤로 보내기': ['back', 'core'], '무릎 끌어올리기': raiseLegs,
      '다리 펴기': ['core', 'hipFlexors', 'quads'], '발끝을 바에 대기': raiseLegs,
      '발을 앞으로 내리기': raiseLegs, '다리 내리기': ['core', 'back'], '다시 매달리기': hang,
    },
    'pull-up': {
      '매달리기': hang, '가슴을 앞으로 보내기': ['glutes', 'back'],
      '다리를 앞으로 보내기': ['core', 'back'], '몸 당기기': pull,
      '턱이 바 위로': pull, '바에서 밀어내기': ['back', 'core'],
      '팔 펴기': ['back', 'biceps'], '다시 매달리기': hang,
    },
    'bar-muscle-up': {
      ...muscleUpStages, '매달리기': hang, '엉덩이 끌어올리기': ['back', 'glutes', 'core'],
      '가슴을 바 위로 넘기기': ['back', 'shoulders', 'core'], '바 위에서 밀어내기': dip,
    },
    'ring-muscle-up': {
      ...muscleUpStages, '링에 매달리기': hang, '링을 몸 가까이 당기기': ['back', 'biceps', 'forearms'],
      '가슴을 링 사이로 넘기기': ['chest', 'shoulders', 'core'], '링 딥으로 밀어내기': dip,
    },
    'push-up': {
      '팔을 편 플랭크': plank, '몸통 내리기': pushUp, '가슴을 바닥 가까이': pushUp,
      '바닥 밀기': pushUp, '팔 펴기': ['triceps', 'chest', 'core'],
    },
    'air-squat': {
      '서서 준비': ['core', 'quads'], '무릎과 엉덩이 굽히기': squat,
      '깊이 앉기': squat, '일어서기': squat, '무릎과 엉덩이 펴기': squat,
    },
    burpee: {
      '서서 준비': ['core', 'quads'], '손 짚기': plank, '발을 뒤로 보내기': ['core', 'glutes'],
      '플랭크': plank, '가슴과 허벅지를 바닥에': pushUp, '바닥 밀기': pushUp,
      '발을 앞으로 모으기': raiseLegs, '손 옆으로 착지': squat, '손 떼고 일어나기': squat,
      '팔을 앞으로 휘두르기': ['quads', 'glutes', 'shoulders'], '바닥을 차고 오르기': jump,
      '점프하며 손 올리기': ['core', 'shoulders'], '팔 내리기': ['core', 'shoulders'],
      '무릎 굽혀 착지': jump, '다시 서기': squat,
    },
    // The butterfly AbMat sit-up emphasizes trunk flexion throughout the repetition.
    // https://www.crossfit.com/essentials/the-abmat-sit-up
    'sit-up': {
      '등 대고 눕기': ['core'], '팔 앞으로 보내기': ['core', 'shoulders'], '상체 일으키기': ['core'],
      '발 쪽으로 손 뻗기': ['core'], '상체 내리기': ['core'], '등 대기': ['core'], '다시 눕기': ['core'],
    },
    'handstand-push-up': {
      '벽에 기대어 물구나무': overhead, '팔 굽히기': ['triceps', 'shoulders'],
      '머리를 바닥에 대기': press, '바닥 밀기': press, '팔 펴기': overhead,
    },
    'box-jump': {
      '박스 앞에 서기': ['core', 'quads'], '팔을 뒤로 보내기': squat,
      '두 발로 도약': jump, '발을 박스 위로': raiseLegs, '박스 위에 착지': jump,
      '박스 위에서 일어서기': squat,
    },
    'double-under': {
      '줄 돌릴 준비': ['forearms'], '무릎 굽히기': ['quads', 'calves'], '두 발로 도약': ['calves', 'quads'],
      '첫 번째 줄 통과': ['forearms', 'core'], '두 번째 회전': ['forearms', 'core'],
      '두 번째 줄 통과': ['forearms', 'core'], '착지 준비': ['forearms', 'core'],
      '두 발로 착지': ['calves', 'quads'], '다음 점프 준비': ['calves', 'forearms'],
    },
    'wall-ball': {
      '공을 가슴 앞에 받치기': ['core', 'biceps'], '스쿼트': squat,
      '일어서며 밀기': ['quads', 'glutes', 'shoulders'], '공 놓기': press,
      '공이 표적으로': ['shoulders'], '표적에 닿기': ['shoulders'],
      '공 내려오기': ['shoulders'], '공 받아내기': ['shoulders', 'quads', 'core'], '다음 스쿼트': squat,
    },
    'kettlebell-swing': {
      '다리 사이로 보내기': hinge, '엉덩이 펴기': hinge,
      '앞으로 스윙': ['glutes', 'core'], '머리 위로': ['shoulders', 'core'],
      '앞으로 내리기': ['core', 'forearms'],
    },
    // https://www.concept2.com/training/articles/rowing-muscles-used
    row: {
      '캐치': ['core', 'forearms'], '다리로 밀기': squat,
      '몸통 뒤로 열기': ['glutes', 'hamstrings', 'back'], '팔로 당기기': pull,
      '피니시': ['back', 'biceps', 'core'], '팔 먼저 펴기': ['triceps'],
      '몸통 앞으로': ['core'], '무릎 접기': ['hamstrings', 'calves'],
    },
  };
})();

function getMovementMuscles(movementId, phaseIndex) {
  if (!Number.isInteger(phaseIndex) || !Object.hasOwn(movementStageMuscles, movementId)) return [];
  const label = getMovementMotion(movementId)?.frames[phaseIndex]?.label;
  return movementStageMuscles[movementId][label] || [];
}
