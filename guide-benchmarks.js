// Each entry describes the Rx version on its linked CrossFit benchmark page.
const guideBenchmarks = [
  {
    id: 'fran', name: '프랜', english: 'Fran', aliases: ['프란', '프렌'],
    description: '쓰러스터와 풀업을 번갈아 하며 라운드마다 횟수를 줄여요.',
    workout: ['쓰러스터를 한 뒤 풀업을 같은 횟수만큼 해요.', '각 동작을 첫 라운드에 21회, 다음에 15회, 마지막에 9회 해요.', '쓰러스터 바벨은 여성 65 lb, 남성 95 lb예요.'],
    scoring: '마지막 풀업을 마칠 때까지 걸린 시간을 분·초로 기록해요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/fran',
  },
  {
    id: 'cindy', name: '신디', english: 'Cindy', aliases: ['씬디'],
    description: '철봉과 맨몸을 이용하는 세 동작을 20분 동안 반복해요.',
    workout: ['풀업 5회 → 푸시업 10회 → 에어 스쿼트 15회가 한 라운드예요.', '20분 동안 이 순서로 가능한 만큼 반복해요.'],
    scoring: '완료한 라운드 수와 마지막 라운드에서 더 한 횟수를 적어요. 8라운드 후 풀업 5회를 했다면 8라운드 + 5회예요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/cindy',
  },
  {
    id: 'grace', name: '그레이스', english: 'Grace', aliases: [],
    description: '바벨 클린 앤 저크 한 동작으로 시간을 재는 와드예요.',
    workout: ['클린 앤 저크 30회를 해요. 클린과 저크를 연결해 1회로 세요.', '바벨은 여성 95 lb, 남성 135 lb예요.'],
    scoring: '30번째 저크를 마친 시간을 분·초로 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/grace',
  },
  {
    id: 'helen', name: '헬렌', english: 'Helen', aliases: ['헬런'],
    description: '달리기에서 케틀벨과 철봉으로 이어지는 세 동작을 3라운드 해요.',
    workout: ['매 라운드 400 m 달리기 → 케틀벨 스윙 21회 → 풀업 12회 순서예요.', '총 3라운드이며 케틀벨은 여성 35 lb, 남성 53 lb예요.'],
    scoring: '세 라운드를 모두 마칠 때까지 걸린 시간을 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/helen',
  },
  {
    id: 'annie', name: '애니', english: 'Annie', aliases: ['애니 와드'],
    description: '더블 언더와 싯업을 50회씩 시작해 마지막에는 10회씩 해요.',
    workout: ['더블 언더를 한 뒤 싯업을 같은 횟수만큼 해요.', '각 동작의 횟수는 라운드 순서대로 50회, 40회, 30회, 20회, 10회예요.'],
    scoring: '마지막 싯업까지 마친 시간을 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/annie',
  },
  {
    id: 'diane', name: '다이앤', english: 'Diane', aliases: ['다이안', '다이엔'],
    description: '데드리프트와 핸드스탠드 푸시업을 한 쌍으로 묶은 와드예요.',
    workout: ['데드리프트 → 핸드스탠드 푸시업 순서로 각 동작을 21회, 15회, 9회씩 해요.', '데드리프트 바벨은 여성 155 lb, 남성 225 lb예요.'],
    scoring: '마지막 핸드스탠드 푸시업을 마친 시간을 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/diane',
  },
  {
    id: 'jackie', name: '재키', english: 'Jackie', aliases: ['잭키', '재키 와드'],
    description: '로잉, 쓰러스터, 풀업을 한 번씩 차례로 마치는 와드예요.',
    workout: ['로잉 1,000 m → 쓰러스터 50회 → 풀업 30회 순서예요.', '쓰러스터 바벨은 여성 35 lb, 남성 45 lb예요.'],
    scoring: '로잉을 시작해 마지막 풀업을 마칠 때까지 걸린 시간을 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/jackie',
  },
  {
    id: 'nancy', name: '낸시', english: 'Nancy', aliases: ['낸씨'],
    description: '400 m 달리기와 오버헤드 스쿼트를 번갈아 해요.',
    workout: ['400 m 달리기 → 오버헤드 스쿼트 15회 순서로 총 5라운드 해요.', '바벨은 여성 65 lb, 남성 95 lb예요.'],
    scoring: '5라운드를 마칠 때까지 걸린 시간을 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/nancy',
  },
  {
    id: 'karen', name: '카렌', english: 'Karen', aliases: ['캐런', '캐렌', '카런'],
    description: '정해진 높이의 표적을 향해 월볼 샷 150회를 해요.',
    workout: ['월볼 샷을 모두 150회 해요.', '여성 기준은 14 lb 공과 9 ft 표적, 남성 기준은 20 lb 공과 10 ft 표적이에요.'],
    scoring: '150회를 마친 시간을 기록해요. 공 무게나 표적 높이를 조정했다면 함께 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/karen',
  },
  {
    id: 'isabel', name: '이사벨', english: 'Isabel', aliases: ['이자벨'],
    description: '바벨 스내치 30회를 마치는 시간을 재요.',
    workout: ['바벨 스내치를 30회 해요.', '바벨은 여성 95 lb, 남성 135 lb예요.'],
    scoring: '30번째 스내치를 마친 시간을 분·초로 적어요.',
    sourceUrl: 'https://www.crossfit.com/benchmark/isabel',
  },
];

if (typeof module !== 'undefined' && module.exports) module.exports = guideBenchmarks;
