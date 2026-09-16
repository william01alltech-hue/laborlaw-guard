/**
 * 勞工守護神 - 本地 M4 Max (Ollama) 與雲端 Groq 雙軌推論中樞與 RAG 整合服務
 */

const http = require('http');
const https = require('https');
const RAGEngine = require('../engine/rag_engine.js');
const HybridQueueScheduler = require('./scheduler.js');

class AIService {
  constructor() {
    this.rag = new RAGEngine();
    this.localModelName = process.env.LOCAL_AI_MODEL || 'qwen3.8:27b';
    this.cloudModelName = process.env.AI_MODEL_NAME || 'qwen-3.8-27b';
    this.groqApiKey = process.env.GROQ_API_KEY || '';

    // 初始化雙軌調度器 (M4 Max 建議 4 併發，排隊滿 30 溢出至雲端)
    this.scheduler = new HybridQueueScheduler({
      localConcurrencyLimit: Number(process.env.LOCAL_CONCURRENCY_LIMIT) || 4,
      maxQueueWaiting: Number(process.env.MAX_QUEUE_WAITING) || 30
    });
  }

  /**
   * 取得調度器即時狀態
   */
  getQueueStatus() {
    return this.scheduler.getStatus();
  }

  /**
   * 諮詢核心入口 (雙軌調度 + 語意快取 + 令函 RAG)
   * @param {string} userQuery 勞工提問
   * @param {string} customApiKey 使用者或自訂 API Key
   */
  async consult(userQuery, customApiKey = '') {
    const cloudKey = customApiKey || this.groqApiKey;

    // 1. 優先檢查快取層（0 Token 成本、0 延遲）
    const cachedAnswer = this.rag.checkCache(userQuery);
    if (cachedAnswer) {
      this.scheduler.metrics.cacheHits++;
      return {
        source: 'SEMANTIC_CACHE',
        model: 'Qwen 3.8-27B (Semantic Cache)',
        answer: cachedAnswer,
        tokenCost: 0,
        queueStatus: this.getQueueStatus()
      };
    }

    // 2. 檢索最相關之官方現行有效令函 (Top 2)
    const matchedDocs = this.rag.search(userQuery, 2);

    // 3. 定義本地工作函式 (優先調用本機 Ollama M4 Max)
    const localTaskFn = async () => {
      try {
        const ollamaRes = await this.callLocalOllama(userQuery, matchedDocs);
        return {
          source: 'LOCAL_OLLAMA_M4_MAX',
          model: `Ollama ${this.localModelName} (M4 Max 本地推論)`,
          answer: ollamaRes,
          matchedDocs,
          queueStatus: this.getQueueStatus()
        };
      } catch (localErr) {
        console.warn('[AI Service] 本機 Ollama 呼叫失敗或未啟動，自動轉由備援通道處理:', localErr.message);
        // 本機若調用失敗，嘗試轉雲端或本地知識庫模板
        if (cloudKey) {
          try {
            const cloudRes = await this.callGroqAPI(userQuery, matchedDocs, cloudKey);
            return {
              source: 'GROQ_CLOUD_FALLBACK',
              model: `Groq ${this.cloudModelName} (雲端備援)`,
              answer: cloudRes,
              matchedDocs,
              queueStatus: this.getQueueStatus()
            };
          } catch (cloudErr) {
            console.warn('[AI Service] 雲端 API 備援亦異常:', cloudErr.message);
          }
        }
        return {
          source: 'LOCAL_RAG_ENGINE',
          model: 'Qwen 3.8-27B (Local Knowledge Engine)',
          answer: this.generateSmartFallback(userQuery, matchedDocs),
          matchedDocs,
          queueStatus: this.getQueueStatus()
        };
      }
    };

    // 4. 定義雲端溢出函式 (排隊滿 30 人時觸發)
    const cloudOverflowFn = async (reason) => {
      console.log(`[AI Service] 觸發雲端分流 (原因: ${reason})，由雲端 Groq API 秒接`);
      if (cloudKey) {
        try {
          const groqResponse = await this.callGroqAPI(userQuery, matchedDocs, cloudKey);
          return {
            source: 'GROQ_CLOUD_SPILLOVER',
            model: `Groq ${this.cloudModelName} (雲端尖峰分流)`,
            answer: groqResponse,
            matchedDocs,
            spilloverReason: reason,
            queueStatus: this.getQueueStatus()
          };
        } catch (err) {
          console.warn('[AI Service] 雲端溢出 API 異常，回退至本地模板:', err.message);
        }
      }

      // 若未設定雲端 Key 或雲端異常，走本地 RAG 模板
      return {
        source: 'LOCAL_RAG_ENGINE',
        model: 'Qwen 3.8-27B (Local Knowledge Engine)',
        answer: this.generateSmartFallback(userQuery, matchedDocs),
        matchedDocs,
        spilloverReason: reason,
        queueStatus: this.getQueueStatus()
      };
    };

    // 5. 由雙軌調度器依據負載分派
    return await this.scheduler.dispatch(localTaskFn, cloudOverflowFn);
  }

  /**
   * 呼叫本機 Ollama 服務 (http://127.0.0.1:11434/api/chat)
   */
  callLocalOllama(query, matchedDocs) {
    return new Promise((resolve, reject) => {
      const systemPrompt = this._buildSystemPrompt(matchedDocs);

      const payload = JSON.stringify({
        model: this.localModelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 1024
        }
      });

      const req = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 45000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              return reject(new Error(`Ollama HTTP ${res.statusCode}: ${data}`));
            }
            const parsed = JSON.parse(data);
            if (parsed.message && parsed.message.content) {
              resolve(parsed.message.content);
            } else {
              reject(new Error('Ollama 回傳內容無 message.content'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama 請求逾時 (45s)'));
      });
      req.on('error', err => reject(err));
      req.write(payload);
      req.end();
    });
  }

  /**
   * 呼叫 Groq Serverless API (相容 OpenAI 格式)
   */
  callGroqAPI(query, matchedDocs, apiKey) {
    return new Promise((resolve, reject) => {
      const systemPrompt = this._buildSystemPrompt(matchedDocs);

      const payload = JSON.stringify({
        model: this.cloudModelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        temperature: 0.2,
        max_tokens: 1024
      });

      const req = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 25000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.choices && parsed.choices.length > 0) {
              resolve(parsed.choices[0].message.content);
            } else {
              reject(new Error(data));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Groq API 請求逾時'));
      });
      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    });
  }

  _buildSystemPrompt(matchedDocs) {
    const contextDocs = matchedDocs.map((doc, idx) => `
【參考函釋 ${idx + 1}】
發文字號：${doc.issue_number}
發布日期：${doc.issue_date}
規範法條：${doc.statute} ${doc.article_refs.join(', ')}
核心主旨：${doc.subject}
令函說明：${doc.content}
    `).join('\n');

    return `你是一位精通中華民國勞動基準法與勞動部歷年行政令函的頂尖勞工權益首席顧問。
請一律使用台灣繁體中文作答。
你的回答必須採用嚴密的法律三段論法，並且【強制引用】下方檢索到的官方函釋發文字號，絕不得隨意虛構字號。

回答格式嚴格規範：
1. 【白話結論】：一句話直接告訴勞工公司這樣做是否違法？
2. 【官方權威依據】：列出對應法條與勞動部/勞委會具體發文字號。
3. 【法律焦點解析】：用一般人聽得懂的口吻拆解公司違法細節與法律罰則。
4. 【勞工自保守則】：具體教導勞工如何截圖、留存通訊或薪資紀錄作為調解證據。
5. 【免責聲明】：附註「本解答依官方函釋提供法律常識參考，非正式法律意見書」。

參考官方令函庫：
${contextDocs || '（暫無完全相符字號，請基於勞動基準法一般原則回答）'}
`;
  }

  /**
   * 智慧本地推論備援（在無模型連線時，結合檢索到的令函產出權威白話文）
   */
  generateSmartFallback(query, matchedDocs) {
    if (matchedDocs.length === 0) {
      return `
🔍 <strong>Qwen 3.8-27B 法律邏輯分析：</strong><br><br>
針對您諮詢的情境：「<em>${escapeHtml(query)}</em>」，依《勞動基準法》第一條意旨，雇主給予勞工之勞動條件不得低於本法所定之最低標準。<br><br>
🏛️ <strong>處理建議：</strong><br>
若公司內部規定或主管要求低於法定標準（如短發工資、未足額加給、任意倒扣），該規定自始無效。建議您前往本系統【薪資體檢】與【排班月曆】輸入實際數據，一鍵產出具備法律效力之調解請求清冊！<br><br>
<small style="color:#64748B;">⚖️ 免責聲明：本內容為勞動法令檢索參考，非正式律師法律意見書。</small>
      `.trim();
    }

    const primaryDoc = matchedDocs[0];
    return `
❌ <strong>結論：公司此舉已涉嫌違反法令！</strong><br><br>
🏛️ <strong>官方權威依據</strong>：<br>
• 《${primaryDoc.statute}》${primaryDoc.article_refs.join('、')}<br>
• 勞動部官方令函：<strong>${primaryDoc.issue_number}</strong> (${primaryDoc.issue_date})<br><br>
💡 <strong>官方令函重點解析</strong>：<br>
${primaryDoc.content}<br><br>
📱 <strong>勞工自保與蒐證指引</strong>：<br>
${primaryDoc.self_protection_tips}<br><br>
<small style="color:#64748B;">⚖️ 免責聲明：本回答依勞動部現行有效令函生成，僅供勞資爭議調解準備參考。</small>
    `.trim();
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

module.exports = new AIService();
