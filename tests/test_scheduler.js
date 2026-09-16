/**
 * 勞工守護神 - 雙軌調度器 (HybridQueueScheduler) 單元與壓力測試
 */

const assert = require('assert');
const HybridQueueScheduler = require('../server/scheduler.js');

console.log('🧪 開始執行雙軌調度器 (scheduler.js) 單元測試...');

async function runTests() {
  // 建立小型測試調度器：本地併發上限 4，排隊上限 10
  const scheduler = new HybridQueueScheduler({
    localConcurrencyLimit: 4,
    maxQueueWaiting: 10
  });

  // 測試 1：初始狀態
  const s0 = scheduler.getStatus();
  assert.strictEqual(s0.activeLocalCount, 0, '初始活躍任務應為 0');
  assert.strictEqual(s0.waitingQueueLength, 0, '初始排隊長度應為 0');
  console.log('✅ [PASS] 測試 1：初始佇列狀態正確');

  // 測試 2：併發 4 個以內任務由本地即時消化
  const delay = (ms, val) => new Promise(r => setTimeout(() => r(val), ms));
  const tasks = [];
  for (let i = 0; i < 4; i++) {
    tasks.push(scheduler.dispatch(
      () => delay(50, `local_${i}`),
      () => Promise.resolve(`cloud_${i}`)
    ));
  }

  // 剛送出時，4 個應全數進入 active
  const s1 = scheduler.getStatus();
  assert.strictEqual(s1.activeLocalCount, 4, '應有 4 個任務在本地並行');
  assert.strictEqual(s1.waitingQueueLength, 0, '排隊隊列應為 0');

  const results = await Promise.all(tasks);
  assert.deepStrictEqual(results, ['local_0', 'local_1', 'local_2', 'local_3']);
  assert.strictEqual(scheduler.getStatus().activeLocalCount, 0, '執行完畢後活躍數應歸零');
  console.log('✅ [PASS] 測試 2：本機併發 4 個任務正確並行消化');

  // 測試 3：高併發排隊與溢出分流 (模擬 4 active + 10 排隊 + 3 個溢出)
  // 4 個卡住 100ms
  // 10 個進入排隊 (合計 14)
  // 再多 3 個 (第 15, 16, 17 個) 必須觸發 cloudTaskFn 溢出
  const allBatch = [];
  for (let i = 0; i < 17; i++) {
    allBatch.push(scheduler.dispatch(
      () => delay(80, `local_job_${i}`),
      (reason) => Promise.resolve(`cloud_spillover_${i}_${reason}`)
    ));
  }

  const s2 = scheduler.getStatus();
  assert.strictEqual(s2.activeLocalCount, 4, '活躍數應為 4');
  assert.strictEqual(s2.waitingQueueLength, 10, '排隊數應達到上限 10');
  assert.strictEqual(scheduler.metrics.spilloverToCloud, 3, '應有 3 個任務溢出到雲端');

  const batchResults = await Promise.all(allBatch);
  // 檢查第 14, 15, 16 索引是否為雲端分流結果
  assert.ok(batchResults[14].startsWith('cloud_spillover_14'), '第 15 個任務應被雲端分流');
  assert.ok(batchResults[15].startsWith('cloud_spillover_15'), '第 16 個任務應被雲端分流');
  assert.ok(batchResults[16].startsWith('cloud_spillover_16'), '第 17 個任務應被雲端分流');
  console.log('✅ [PASS] 測試 3：排隊滿載溢出機制 (Spillover) 100% 精準分流');

  console.log('\n🎉 雙軌調度器所有併發與排隊極限測試全部通過！');
}

runTests().catch(err => {
  console.error('❌ 調度器測試失敗:', err);
  process.exit(1);
});
