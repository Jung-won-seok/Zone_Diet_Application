const { ApiError } = require('../index');

function getStoreMode(defaultMode = 'blob') {
  const mode = process.env.LEBEN_STORE || defaultMode;
  if (['postgres', 'blob'].includes(mode) || (mode === 'local' && defaultMode === 'local')) return mode;
  throw new ApiError(503, '저장소 설정을 확인해주세요.');
}

function checkMaintenance() {
  if (process.env.LEBEN_MAINTENANCE === '1') {
    throw new ApiError(503, '예약 시스템 점검 중입니다. 잠시 후 다시 시도해주세요.');
  }
}

module.exports = { getStoreMode, checkMaintenance };
