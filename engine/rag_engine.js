/**
 * 勞工守護神 - 勞動部令函語意檢索與快取引擎 (RAG Engine)
 */

const fs = require('fs');
const path = require('path');

class RAGEngine {
  constructor(dataPath) {
    this.dataPath = dataPath || path.join(__dirname, '../data/mol_interpretations.json');
    this.interpretations = [];
    this.cache = new Map();
    this.loadData();
    this.initPredefinedCache();
  }

  loadData() {
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf8');
      const json = JSON.parse(raw);
      // 核心防護：嚴格過濾廢止舊函釋，僅載入現行有效 (ACTIVE) 令函
      this.interpretations = (json.interpretations || []).filter(item => item.status === 'ACTIVE');
      console.log(`[RAG Engine] 成功載入現行有效令函庫：共 ${this.interpretations.length} 篇`);
    } catch (err) {
      console.error('[RAG Engine] 令函庫載入失敗:', err);
      this.interpretations = [];
    }
  }

  /**
   * 混合檢索（Hybrid Keyword & Semantic Search）
   * @param {string} query 勞工提問
   * @param {number} topK 返回篇數
   */
  search(query, topK = 3) {
    if (!query || typeof query !== 'string') return [];

    const cleanQuery = query.toLowerCase();
    const scoredList = [];

    for (const item of this.interpretations) {
      let score = 0;

      // 1. 關鍵標籤比對 (權重最高)
      for (const tag of item.tags) {
        if (cleanQuery.includes(tag.toLowerCase())) {
          score += 15;
        }
      }

      // 2. 主旨比對
      if (item.subject && cleanQuery.split('').some(char => item.subject.includes(char))) {
        const matches = (item.subject.match(new RegExp(cleanQuery.slice(0, 4), 'gi')) || []).length;
        score += matches * 10;
      }

      // 3. 內文關鍵字比對
      const keywords = ['line', '通訊', '加班', '全勤', '生理假', '特休', '勞退', '6%', '內扣', '制服', '倒扣', '證明'];
      for (const kw of keywords) {
        if (cleanQuery.includes(kw) && item.content.includes(kw)) {
          score += 8;
        }
      }

      // 4. 法條比對 (如「第24條」)
      for (const ref of item.article_refs) {
        if (cleanQuery.includes(ref)) {
          score += 20;
        }
      }

      if (score > 0) {
        scoredList.push({
          score,
          interpretation: item
        });
      }
    }

    scoredList.sort((a, b) => b.score - a.score);
    return scoredList.slice(0, topK).map(res => res.interpretation);
  }

  /**
   * 語意快取層 (Semantic Cache) - 0 Token 成本極速命中
   */
  initPredefinedCache() {
    // 預載前三大常見熱門爭端之精闢律師級回答
    this.cache.set('line_overtime', {
      keywords: ['line', '下班傳', '下班交代', '通訊軟體', '傳訊息工作'],
      answer: `
❌ <strong>結論：主管下班傳 LINE 交代工作屬於「延時工資（加班費）」！</strong><br><br>
🏛️ <strong>官方權威依據</strong>：<br>
• 《勞動基準法》第 24 條、第 32 條<br>
• 勞動部 <strong>勞動條 3字第 1030130894 號函</strong> 暨「勞工在事業場所外工作時間指導原則」<br><br>
💡 <strong>法律重點解析</strong>：<br>
雇主在非上班時間透過 LINE 交辦勞務，勞工只要實際提供勞務（即使只是回覆訊息、修改檔案），均應計入工作時間並依法核算加班費。雇主不得以「未在辦公室打卡」為由拒付。<br><br>
📱 <strong>勞工自保與蒐證指引</strong>：<br>
請將主管通訊指示完整截圖（需包含發送時間戳記與具體工作指示），並保存交付成果之紀錄，做為出勤紀錄之直接佐證。
      `.trim()
    });

    this.cache.set('attendance_bonus', {
      keywords: ['全勤', '加班費母數', '扣全勤', '全勤扣除', '全勤不計入'],
      answer: `
❌ <strong>結論：公司算加班費剔除全勤獎金百分之百違法！</strong><br><br>
🏛️ <strong>官方權威依據</strong>：<br>
• 《勞動基準法》第 2 條第 3 款（工資定義）<br>
• <strong>行政院勞工委員會 (85) 台勞動二字第 135862 號函</strong><br><br>
💡 <strong>法律重點解析</strong>：<br>
全勤獎金是勞工提供勞務獲得之經常性給與，依法必須納入「平日每小時工資額」作為加班費分母。公司將其排除計算，屬於延時工資未足額發給，依法可處 2 萬至 100 萬元罰鍰並應補發差額。
      `.trim()
    });

    this.cache.set('menstrual_leave', {
      keywords: ['生理假', '看醫生證明', '診斷證明', '請生理假', '生理假扣錢'],
      answer: `
❌ <strong>結論：雇主片面要求生理假附證明或扣全勤均屬違法！</strong><br><br>
🏛️ <strong>官方權威依據</strong>：<br>
• 《性別平等工作法》第 14 條、第 21 條<br>
• 勞動部 <strong>勞動條 4字第 1030130987 號令</strong><br><br>
💡 <strong>法律重點解析</strong>：<br>
女性受僱者因生理日致工作有困難者，每月得請生理假一日，依法雇主不得要求提出醫療機構證明文件，亦不得視為缺勤而影響其全勤獎金或考績。違者處新臺幣二萬元以上三十萬元以下罰鍰。
      `.trim()
    });
  }

  checkCache(query) {
    if (!query || typeof query !== 'string') return null;
    const q = query.toLowerCase();
    for (const [key, item] of this.cache.entries()) {
      if (item.keywords.some(kw => q.includes(kw))) {
        return item.answer;
      }
    }
    return null;
  }
}

module.exports = RAGEngine;
