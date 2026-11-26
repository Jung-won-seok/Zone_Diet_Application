const guideTermsGlossary = 'https://www.crossfit.com/essentials/crossfit-terms-explained';

const guideTerms = [
  {
    id: 'wod', name: '와드', english: 'WOD', aliases: ['Workout of the Day', '오늘의 운동'],
    description: '그날 진행하는 운동이에요. 와드를 읽을 때는 어떤 동작을 하는지, 얼마나 하는지, 무엇을 기록하는지 차례로 확인해요.',
    example: '오늘 와드가 신디(Cindy)라면 풀업·푸시업·에어 스쿼트를 20분 동안 반복해요.',
    sourceUrl: guideTermsGlossary,
  },
  {
    id: 'amrap', name: '암랩', english: 'AMRAP', aliases: ['앰랩', '암렙', 'As Many Rounds As Possible', 'As Many Reps As Possible'],
    description: '정해진 시간에 가능한 만큼 라운드나 반복 횟수를 쌓는 방식이에요.',
    example: '10분 동안 4라운드를 끝내고 다음 라운드 동작을 6회 했다면 기록은 4라운드 + 6회예요.',
    sourceUrl: guideTermsGlossary,
  },
  {
    id: 'emom', name: '이맘', english: 'EMOM', aliases: ['이몸', '에브리 미닛', 'Every Minute on the Minute'],
    description: '매분 시작할 때 정해진 동작을 해요. 그 분량을 일찍 마치면 다음 분이 시작될 때까지 쉴 수 있어요.',
    example: '10분 EMOM에 버피 5회라면 매분 버피 5회를 시작하고, 이 과정을 10번 반복해요.',
    sourceUrl: guideTermsGlossary,
  },
  {
    id: 'for-time', name: '포 타임', english: 'For Time', aliases: ['포타임', 'Rounds for Time', 'RFT'],
    description: '정해진 운동량을 모두 마치는 데 걸린 시간이 기록이에요. 여러 라운드를 이어서 할 때는 마지막 라운드까지 시간을 재요.',
    example: '프랜의 마지막 풀업을 마쳤을 때 6분 42초였다면 그 시간을 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/fran',
  },
  {
    id: 'rx', name: '지정 기준', english: 'Rx', aliases: ['Rx’d', "Rx'd", 'RxD', '알엑스', 'As Prescribed'],
    description: '와드에 제시된 동작·무게·횟수 등 기준을 그대로 수행했다는 뜻이에요.',
    example: '프랜에서 제시된 바벨 무게를 쓰고 각 라운드의 쓰러스터와 풀업을 모두 채우면 Rx로 기록해요.',
    sourceUrl: guideTermsGlossary,
  },
  {
    id: 'scaled', name: '스케일드', english: 'Scaled', aliases: ['스케일링', '스케일', 'Scaling', 'Scale'],
    description: '내가 오늘 수행할 수 있도록 동작이나 무게, 운동량을 조정한 버전이에요.',
    example: '풀업을 링 로우로 바꿨다면 운동 기록에 “링 로우 사용”이라고 적어 다음에 비교할 수 있어요.',
    sourceUrl: guideTermsGlossary,
  },
  {
    id: 'rep', name: '반복 횟수', english: 'Rep', aliases: ['렙', '렙스', 'Reps', 'Repetition', 'Repetitions'],
    description: '한 동작을 정해진 기준대로 한 번 마칠 때마다 1회로 세요. 동작 옆의 숫자는 보통 그 동작의 반복 횟수예요.',
    example: '“10 reps of squats”라면 스쿼트를 10번 해요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/annie',
  },
  {
    id: 'round', name: '라운드', english: 'Round', aliases: ['라운즈', 'Rounds'],
    description: '목록에 있는 동작을 정해진 순서와 양만큼 한 바퀴 마치면 1라운드예요.',
    example: '신디에서는 풀업 5회, 푸시업 10회, 에어 스쿼트 15회까지 모두 하면 1라운드예요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/cindy',
  },
  {
    id: 'time-cap', name: '타임 캡', english: 'Time Cap', aliases: ['타임캡', '제한 시간', '제한시간'],
    description: '와드를 마칠 수 있는 제한 시간이에요. 미완료 시 기록 방법은 그날 와드 안내를 따라요.',
    example: '타임 캡이 12분이라면 12분에 멈추고, 완료 횟수를 적는 와드에서는 그때까지 마친 반복 수를 남겨요.',
    sourceUrl: 'https://games.crossfit.com/article/2025-semifinals-frequently-asked-questions',
  },
  {
    id: 'benchmark', name: '벤치마크', english: 'Benchmark', aliases: ['벤치마크 와드', 'Benchmark WOD'],
    description: '같은 구성으로 다시 해보면서 지난번 수행 기록과 비교할 수 있는 운동이에요.',
    example: '지난번과 같은 무게로 프랜을 했다면 두 번의 완료 시간을 비교해 보세요.',
    sourceUrl: guideTermsGlossary,
  },
];
