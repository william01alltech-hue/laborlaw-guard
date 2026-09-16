/**
 * 勞工守護神 - 本地與雲端混合雙軌任務調度器 (Hybrid Queue Scheduler)
 * 專為 Apple M4 Max (16核心, 64GB) 本地 Ollama 與雲端 Groq API 協同作業設計
 */

class HybridQueueScheduler {
  constructor(options = {}) {
    // 本地最佳併發數 (M4 Max 建議 4 個平行推論)
    this.localConcurrencyLimit = options.localConcurrencyLimit || 4;
    // 本地最大排隊等待上限 (超過 30 個即刻觸發溢出分流至雲端)
    this.maxQueueWaiting = options.maxQueueWaiting || 30;

    this.activeLocalCount = 0;
    this.waitingQueue = [];

    // 統計數據
    this.metrics = {
      totalRequests: 0,
      handledLocally: 0,
      spilloverToCloud: 0,
      cacheHits: 0
    };
  }

  /**
   * 取得當前佇列與負載狀態
   */
  getStatus() {
    return {
      activeLocalCount: this.activeLocalCount,
      localConcurrencyLimit: this.localConcurrencyLimit,
      waitingQueueLength: this.waitingQueue.length,
      maxQueueWaiting: this.maxQueueWaiting,
      isLocalSaturated: this.activeLocalCount >= this.localConcurrencyLimit,
      isQueueFull: this.waitingQueue.length >= this.maxQueueWaiting,
      metrics: { ...this.metrics }
    };
  }

  /**
   * 派遣任務
   * @param {Function} localTaskFn 本地執行函式 (需返回 Promise)
   * @param {Function} cloudTaskFn 雲端溢出執行函式 (需返回 Promise)
   * @returns {Promise<any>}
   */
  async dispatch(localTaskFn, cloudTaskFn) {
    this.metrics.totalRequests++;

    // 決策 1：本地尚有空閒併發槽位，立即本地執行
    if (this.activeLocalCount < this.localConcurrencyLimit) {
      return this._runLocally(localTaskFn);
    }

    // 決策 2：本地併發已滿 (>=4)，但排隊數未達 30，進入等待隊列
    if (this.waitingQueue.length < this.maxQueueWaiting) {
      return new Promise((resolve, reject) => {
        this.waitingQueue.push({
          localTaskFn,
          cloudTaskFn,
          resolve,
          reject,
          enqueuedAt: Date.now()
        });
      });
    }

    // 決策 3：排隊隊列已滿 (>=30)，觸發「雲端即刻溢出分流 (Spillover)」
    this.metrics.spilloverToCloud++;
    return cloudTaskFn('QUEUE_OVERFLOW_EXCEEDED_30');
  }

  /**
   * 執行本地任務並在結束後推進隊列
   */
  async _runLocally(taskFn) {
    this.activeLocalCount++;
    this.metrics.handledLocally++;

    try {
      const result = await taskFn();
      return result;
    } finally {
      this.activeLocalCount--;
      this._processNextInQueue();
    }
  }

  /**
   * 消化隊列中的下一個任務
   */
  _processNextInQueue() {
    if (this.waitingQueue.length === 0) return;
    if (this.activeLocalCount >= this.localConcurrencyLimit) return;

    const nextJob = this.waitingQueue.shift();
    if (!nextJob) return;

    this._runLocally(nextJob.localTaskFn)
      .then(nextJob.resolve)
      .catch(nextJob.reject);
  }
}

module.exports = HybridQueueScheduler;
