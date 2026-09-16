/**
 * 勞工守護神 (Labor Law Guard) - 前端核心控制器
 */

// 應用全域狀態
const AppState = {
  constants: null,
  currentTab: 'view-salary',
  selectedDate: null,
  currentYear: 2026,
  currentMonth: 2, // 0-indexed, 2 = 3月
  scheduleRecords: {}, // 格式: 'YYYY-MM-DD': { day_type, normal_hours, overtime_hours }
  latestReport: null
};

// 待載入完成後初始化
document.addEventListener('DOMContentLoaded', async () => {
  await initConstants();
  initServiceWorker();
  initNetworkSentinel();
  initTabNavigation();
  initSalaryForm();
  initCalendar();
  initAIChat();
  initReportActions();
  console.log('🚀 勞工守護神 PWA 系統已啟動完成！');
});

// ================= 0. PWA Service Worker 註冊 =================
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('📡 [Service Worker] 註冊成功，範圍:', reg.scope))
        .catch(err => console.warn('⚠️ [Service Worker] 註冊失敗:', err));
    });
  }
}

// ================= 1. 法規常數載入 =================
async function initConstants() {
  try {
    let res;
    try {
      res = await fetch('/constants/labor_constants.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (e) {
      res = await fetch('../constants/labor_constants.json');
    }
    AppState.constants = await res.json();
    console.log(`[OK] 成功掛載勞基法常數庫 v${AppState.constants.version}`);
  } catch (err) {
    console.error('常數載入失敗，使用預設常數備援', err);
  }
}

// ================= 2. 必須在線守衛 (Network Sentinel) =================
function initNetworkSentinel() {
  const overlay = document.getElementById('offline-guard-overlay');
  const indicator = document.getElementById('network-indicator');
  const btnReconnect = document.getElementById('btn-reconnect');

  function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    if (isOnline) {
      overlay.classList.add('hidden');
      indicator.className = 'network-badge online';
      indicator.innerHTML = '<span class="dot"></span><span class="label">在線保護中</span>';
    } else {
      overlay.classList.remove('hidden');
      indicator.className = 'network-badge offline';
      indicator.innerHTML = '<span class="dot" style="background:#F43F5E;"></span><span class="label">離線受限</span>';
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  btnReconnect.addEventListener('click', updateOnlineStatus);

  updateOnlineStatus();
}

// ================= 3. 分頁切換 (Tab Navigation) =================
function initTabNavigation() {
  const navItems = document.querySelectorAll('.nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // 薪資精靈的下一步按鈕
  document.getElementById('btn-to-schedule').addEventListener('click', () => {
    switchTab('view-schedule');
  });

  // 開始全面診斷按鈕
  document.getElementById('btn-start-diagnosis').addEventListener('click', () => {
    runFullDiagnosis();
    switchTab('view-report');
  });
}

function switchTab(tabId) {
  AppState.currentTab = tabId;

  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-view').forEach(view => {
    if (view.id === tabId) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ================= 4. 薪資向導與母數試算 =================
function initSalaryForm() {
  const inputs = [
    'input-base-salary',
    'input-attendance-bonus',
    'input-meal-allowance',
    'input-duty-allowance'
  ];

  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateWagePreview);
  });

  // 聘僱型態切換（月薪 vs 時薪）
  const typeRadios = document.querySelectorAll('input[name="employment_type"]');
  typeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const isHourly = radio.value === 'hourly';
      const lblBase = document.getElementById('lbl-base-salary');
      const inputBase = document.getElementById('input-base-salary');
      const lblTotal = document.getElementById('lbl-preview-total');

      if (isHourly) {
        if (lblBase) lblBase.textContent = '約定時薪 (元)';
        if (lblTotal) lblTotal.textContent = '約定法定時薪';
        if (inputBase && (inputBase.value === '28590' || !inputBase.value)) {
          inputBase.value = 190;
        }
      } else {
        if (lblBase) lblBase.textContent = '約定本薪 / 底薪 (元)';
        if (lblTotal) lblTotal.textContent = '經常性工資總額';
        if (inputBase && inputBase.value === '190') {
          inputBase.value = 28590;
        }
      }
      updateWagePreview();
    });
  });

  const checkPensionInward = document.getElementById('check-pension-inward');
  const boxPensionAmount = document.getElementById('box-pension-amount');
  const inputPensionDeducted = document.getElementById('input-pension-deducted');

  checkPensionInward.addEventListener('change', () => {
    if (checkPensionInward.checked) {
      boxPensionAmount.classList.remove('hidden');
      const base = Number(document.getElementById('input-base-salary').value) || 28590;
      inputPensionDeducted.value = Math.round(base * 0.06);
    } else {
      boxPensionAmount.classList.add('hidden');
      inputPensionDeducted.value = 0;
    }
  });

  updateWagePreview();
}

function updateWagePreview() {
  const empTypeEl = document.querySelector('input[name="employment_type"]:checked');
  const isHourly = empTypeEl && empTypeEl.value === 'hourly';

  const base = Number(document.getElementById('input-base-salary').value) || 0;
  const attendance = Number(document.getElementById('input-attendance-bonus').value) || 0;
  const meal = Number(document.getElementById('input-meal-allowance').value) || 0;
  const duty = Number(document.getElementById('input-duty-allowance').value) || 0;

  if (isHourly) {
    // 時薪制：以約定時薪為直接每小時工資母數
    const hourlyRate = base.toFixed(1);
    document.getElementById('preview-total-wage').textContent = `$ ${base.toLocaleString()} / 時`;
    document.getElementById('preview-hourly-rate').textContent = `$ ${hourlyRate} / hr`;
  } else {
    // 月薪制：依法將底薪、全勤、伙食與職務加給合併除以 240
    const totalRegular = base + attendance + meal + duty;
    const hourlyRate = (totalRegular / 240).toFixed(1);
    document.getElementById('preview-total-wage').textContent = `$ ${totalRegular.toLocaleString()}`;
    document.getElementById('preview-hourly-rate').textContent = `$ ${hourlyRate} / hr`;
  }
}

// ================= 5. 互動式排班月曆 =================
function initCalendar() {
  renderCalendarDays(AppState.currentYear, AppState.currentMonth);

  document.getElementById('cal-prev').addEventListener('click', () => {
    AppState.currentMonth--;
    if (AppState.currentMonth < 0) {
      AppState.currentMonth = 11;
      AppState.currentYear--;
    }
    renderCalendarDays(AppState.currentYear, AppState.currentMonth);
  });

  document.getElementById('cal-next').addEventListener('click', () => {
    AppState.currentMonth++;
    if (AppState.currentMonth > 11) {
      AppState.currentMonth = 0;
      AppState.currentYear++;
    }
    renderCalendarDays(AppState.currentYear, AppState.currentMonth);
  });

  document.getElementById('btn-close-drawer').addEventListener('click', () => {
    document.getElementById('day-editor-drawer').classList.add('hidden');
  });

  document.querySelectorAll('.type-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('btn-save-day').addEventListener('click', saveDayRecord);
  seedDefaultSchedule();
}

function seedDefaultSchedule() {
  const y = AppState.currentYear;
  const m = String(AppState.currentMonth + 1).padStart(2, '0');
  
  for (let d = 1; d <= 8; d++) {
    const dStr = String(d).padStart(2, '0');
    AppState.scheduleRecords[`${y}-${m}-${dStr}`] = {
      day_type: 'weekday',
      normal_hours: 8,
      overtime_hours: d <= 3 ? 2 : 0
    };
  }
}

function renderCalendarDays(year, month) {
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  document.getElementById('cal-month-title').textContent = `${year} 年 ${monthNames[month]}`;

  const grid = document.getElementById('calendar-days-grid');
  grid.innerHTML = '';

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day-cell empty';
    emptyCell.style.opacity = '0.15';
    grid.appendChild(emptyCell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const record = AppState.scheduleRecords[dateKey];

    let tagText = '正常';
    if (record) {
      if (record.day_type === 'rest_day') {
        tagText = '休';
        cell.classList.add('is-rest');
      } else if (record.day_type === 'regular_leave') {
        tagText = '例';
        cell.classList.add('is-rest');
      } else if (record.overtime_hours > 0) {
        tagText = `+${record.overtime_hours}H`;
        cell.classList.add('is-ot');
      }
    } else {
      const dayOfWeek = new Date(year, month, day).getDay();
      if (dayOfWeek === 6) {
        tagText = '休';
        cell.classList.add('is-rest');
      } else if (dayOfWeek === 0) {
        tagText = '例';
        cell.classList.add('is-rest');
      }
    }

    cell.innerHTML = `
      <span class="day-num">${day}</span>
      <span class="day-tag">${tagText}</span>
    `;

    cell.addEventListener('click', () => openDayEditor(dateKey, day));
    grid.appendChild(cell);
  }
}

function openDayEditor(dateKey, dayNumber) {
  AppState.selectedDate = dateKey;
  const drawer = document.getElementById('day-editor-drawer');
  document.getElementById('drawer-date-title').textContent = `設定 ${dateKey} 出勤打卡狀態`;

  const existing = AppState.scheduleRecords[dateKey] || {
    day_type: 'weekday',
    normal_hours: 8,
    overtime_hours: 0
  };

  document.querySelectorAll('.type-pill').forEach(pill => {
    if (pill.getAttribute('data-type') === existing.day_type) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });

  document.getElementById('drawer-normal-hours').value = existing.normal_hours;
  document.getElementById('drawer-overtime-hours').value = existing.overtime_hours;

  drawer.classList.remove('hidden');
}

function saveDayRecord() {
  if (!AppState.selectedDate) return;

  const activePill = document.querySelector('.type-pill.active');
  const dayType = activePill ? activePill.getAttribute('data-type') : 'weekday';
  const normalHours = Number(document.getElementById('drawer-normal-hours').value) || 0;
  const overtimeHours = Number(document.getElementById('drawer-overtime-hours').value) || 0;

  AppState.scheduleRecords[AppState.selectedDate] = {
    day_type: dayType,
    normal_hours: normalHours,
    overtime_hours: overtimeHours
  };

  document.getElementById('day-editor-drawer').classList.add('hidden');
  renderCalendarDays(AppState.currentYear, AppState.currentMonth);
}

// ================= 6. 核心診斷運算與報告展示 =================
function runFullDiagnosis() {
  if (!AppState.constants || !window.LaborCalculator) {
    alert('法規引擎載入中，請稍候重試');
    return;
  }

  const empType = document.querySelector('input[name="employment_type"]:checked').value;
  const baseSalary = Number(document.getElementById('input-base-salary').value) || 28590;
  const attendance = Number(document.getElementById('input-attendance-bonus').value) || 0;
  const meal = Number(document.getElementById('input-meal-allowance').value) || 0;
  const duty = Number(document.getElementById('input-duty-allowance').value) || 0;
  const reportedLabor = Number(document.getElementById('input-reported-labor').value) || baseSalary;
  const dependentsCount = Number(document.getElementById('input-dependents-count').value) || 0;
  const actualOvertimePaid = Number(document.getElementById('input-actual-overtime-paid').value) || 0;
  const pensionInward = Number(document.getElementById('input-pension-deducted').value) || 0;
  const flexibleSystem = document.getElementById('select-flexible-system').value;

  const records = Object.keys(AppState.scheduleRecords).map(date => ({
    date,
    day_type: AppState.scheduleRecords[date].day_type,
    normal_hours: AppState.scheduleRecords[date].normal_hours,
    overtime_hours: AppState.scheduleRecords[date].overtime_hours
  }));

  const hireDate = document.getElementById('input-hire-date')?.value || '2023-01-01';

  const inputPayload = {
    employment_type: empType,
    hire_date: hireDate,
    check_date: new Date().toISOString().split('T')[0],
    flexible_system: flexibleSystem,
    has_union_or_meeting_consent: false,
    dependents_count: dependentsCount,
    salary_info: {
      base_salary: baseSalary,
      attendance_bonus: attendance,
      meal_allowance: meal,
      duty_allowance: duty,
      reported_labor_salary: reportedLabor,
      actual_overtime_paid: actualOvertimePaid,
      deductions: {
        pension_6_percent_deducted: pensionInward
      }
    },
    schedule_records: records
  };

  const report = LaborCalculator.generateDiagnosticReport(inputPayload, AppState.constants);
  AppState.latestReport = report;

  renderReportView(report);
}

function renderReportView(report) {
  const riskBadge = document.getElementById('report-risk-badge');
  if (report.summary.riskLevel === 'CRITICAL') {
    riskBadge.className = 'risk-pill critical';
    riskBadge.textContent = '🚨 發現重大違法事實';
  } else {
    riskBadge.className = 'risk-pill safe';
    riskBadge.textContent = '✅ 初步合規良好';
  }

  animateCounter('report-total-claim', report.summary.totalClaimAmount);

  document.getElementById('stat-violations-count').textContent = `${report.summary.violationCount} 項`;
  document.getElementById('stat-hourly-rate').textContent = `$ ${report.summary.regularHourlyWage}/h`;
  document.getElementById('stat-pension-tier').textContent = `$ ${report.insuranceComp.statutoryTiers.laborPension.toLocaleString()}`;

  // 渲染特休與資遣費試算卡片
  if (report.leaveSeverance) {
    const tenureBadge = document.getElementById('report-tenure-badge');
    const leaveDays = document.getElementById('report-leave-days');
    const leaveCashout = document.getElementById('report-leave-cashout');
    const severancePay = document.getElementById('report-severance-pay');

    if (tenureBadge) tenureBadge.textContent = `年資：${report.leaveSeverance.tenureYears} 年 (${report.leaveSeverance.tenureMonths} 個月)`;
    if (leaveDays) leaveDays.textContent = `${report.leaveSeverance.statutoryLeaveDays} 天`;
    if (leaveCashout) leaveCashout.textContent = `折算未休代金：$ ${report.leaveSeverance.estimatedFullLeaveCashout.toLocaleString()} 元`;
    if (severancePay) severancePay.textContent = `$ ${report.leaveSeverance.estimatedSeverancePay.toLocaleString()} 元`;
  }

  const container = document.getElementById('violations-container');
  container.innerHTML = '';

  if (report.allViolations.length === 0) {
    container.innerHTML = `
      <div class="glassmorphism" style="padding:16px; text-align:center; color:#10B981;">
        🎉 恭喜！目前輸入之工資與排班紀錄未檢出違反勞基法紅線情事。
      </div>
    `;
  } else {
    report.allViolations.forEach(v => {
      const card = document.createElement('div');
      card.className = 'violation-card glassmorphism';
      
      let claimBadge = '';
      if (v.restitution_amount && v.restitution_amount > 0) {
        claimBadge = `<span class="v-restitution">可請求返還 $ ${v.restitution_amount.toLocaleString()} 元</span>`;
      }

      card.innerHTML = `
        <div class="v-header">
          <span class="v-law">${v.law}</span>
          ${claimBadge}
        </div>
        <div class="v-title">${v.title}</div>
        <div class="v-desc">${v.description}</div>
      `;
      container.appendChild(card);
    });
  }
}

function animateCounter(elementId, targetValue) {
  const el = document.getElementById(elementId);
  const start = 0;
  const duration = 1000;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOutQuad = 1 - (1 - progress) * (1 - progress);
    const current = Math.floor(start + (targetValue - start) * easeOutQuad);
    el.textContent = current.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = targetValue.toLocaleString();
    }
  }

  requestAnimationFrame(update);
}

// ================= 7. Qwen 3.8-27B AI 諮詢對話 (串接 /api/chat) =================
function initAIChat() {
  const input = document.getElementById('chat-input-field');
  const btnSend = document.getElementById('btn-send-chat');

  btnSend.addEventListener('click', () => sendUserMessage());
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendUserMessage();
  });

  document.querySelectorAll('.quick-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const q = tag.getAttribute('data-q');
      input.value = q;
      sendUserMessage();
    });
  });
}

async function sendUserMessage() {
  const input = document.getElementById('chat-input-field');
  const text = input.value.trim();
  if (!text) return;

  appendChatBubble('user', text);
  input.value = '';

  const container = document.getElementById('chat-messages');
  const loadingBubble = document.createElement('div');
  loadingBubble.className = 'chat-bubble ai-bubble thinking-bubble';
  loadingBubble.innerHTML = `
    <div class="bubble-header">
      <span class="bot-badge">Qwen 3.8-27B (Thinking Mode)</span>
      <span class="bot-status">深度法律推論中...</span>
    </div>
    <div class="bubble-content" style="color:var(--accent-cyan);">
      ⚡ 正在檢索台灣勞動部令函資料庫並進行三段論法推導...
    </div>
  `;
  container.appendChild(loadingBubble);
  container.scrollTop = container.scrollHeight;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text })
    });
    const result = await response.json();

    loadingBubble.remove();

    if (result.success) {
      appendChatBubble('ai', result.answer, result.model, result.source);
    } else {
      appendChatBubble('ai', '⚠️ 抱歉，AI 服務連線暫時發生異常，請稍候重試。');
    }
  } catch (err) {
    loadingBubble.remove();
    console.error('AI 諮詢失敗:', err);
    appendChatBubble('ai', '🌐 網路連線中斷，無法連接法規雲端庫。請檢查網路狀態後再次嘗試！');
  }
}

function appendChatBubble(role, content, title = '', source = '') {
  const container = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'user-bubble' : 'ai-bubble'}`;

  if (role === 'ai') {
    let sourceBadge = title || 'Qwen 3.8-27B 深度解析';
    let statusText = '依官方函釋依據';

    if (source === 'LOCAL_OLLAMA_M4_MAX') {
      sourceBadge = '🏠 本機 M4 Max (Qwen 3.8-27B)';
      statusText = '⚡ 本地神經網路極速推論';
    } else if (source === 'GROQ_CLOUD_SPILLOVER') {
      sourceBadge = '⚡ 雲端極速分流 (Groq Qwen 3.8-27B)';
      statusText = '🚀 尖峰排隊自動溢出分流';
    } else if (source === 'SEMANTIC_CACHE') {
      sourceBadge = '⚡ 本地語意快取 (0延遲)';
      statusText = '🎯 專利熱門爭端秒回';
    } else if (source === 'LOCAL_RAG_ENGINE') {
      sourceBadge = '📚 本地官方令函庫 (RAG)';
      statusText = '🏛️ 勞動部現行有效法規';
    }

    bubble.innerHTML = `
      <div class="bubble-header">
        <span class="bot-badge">${sourceBadge}</span>
        <span class="bot-status">${statusText}</span>
      </div>
      <div class="bubble-content">${content}</div>
    `;
  } else {
    bubble.textContent = content;
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

// ================= 8. 獎勵廣告解鎖與正式調解存證輸出 =================
function initReportActions() {
  const btnDownload = document.getElementById('btn-download-pdf-reward');
  const unlockedActions = document.getElementById('unlocked-actions');
  const btnPrint = document.getElementById('btn-print-report');
  const btnExportTxt = document.getElementById('btn-export-txt');

  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      if (!navigator.onLine) {
        alert('⚠️ 系統目前處於離線狀態，請先連接網路以載入贊助廣告後下載。');
        return;
      }

      btnDownload.disabled = true;
      btnDownload.innerHTML = '<span>🎬 贊助影片廣告播放中 (請稍候 3 秒)...</span>';

      setTimeout(() => {
        btnDownload.disabled = false;
        btnDownload.innerHTML = '<span>✅ 贊助權限已解鎖！請選擇輸出方式：</span>';
        if (unlockedActions) {
          unlockedActions.classList.remove('hidden');
        }
      }, 3000);
    });
  }

  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      if (!AppState.latestReport) {
        runFullDiagnosis();
      }
      window.print();
    });
  }

  if (btnExportTxt) {
    btnExportTxt.addEventListener('click', () => {
      if (!AppState.latestReport) {
        runFullDiagnosis();
      }
      exportReportAsText(AppState.latestReport);
    });
  }
}

function exportReportAsText(report) {
  if (!report) {
    alert('請先於系統執行體檢運算後再匯出存證清冊！');
    return;
  }

  const now = new Date().toISOString().split('T')[0];
  let txt = `=======================================================
中華民國 勞資爭議調解存證計算清冊 (調解申請書附件)
產出系統：勞工守護神 - 勞基法智慧體檢與存證系統
體檢基準日期：${now}
=======================================================\n\n`;

  txt += `【一、勞工受僱與工資母數基本資料】\n`;
  txt += `• 聘僱型態：${report.wageBase.regularWageBreakdown ? '月薪制勞工' : '時薪制勞工'}\n`;
  txt += `• 經常性給與總額：NT$ ${report.wageBase.totalRegularWage?.toLocaleString()} 元\n`;
  txt += `• 平日每小時工資母數 (R)：NT$ ${report.summary.regularHourlyWage} 元 / 小時\n`;
  if (report.leaveSeverance) {
    txt += `• 累計受僱年資：${report.leaveSeverance.tenureYears} 年 (折合 ${report.leaveSeverance.tenureMonths} 個月)\n`;
    txt += `• 法定特別休假：${report.leaveSeverance.statutoryLeaveDays} 天 (未休折算代金預估：NT$ ${report.leaveSeverance.estimatedFullLeaveCashout.toLocaleString()} 元)\n`;
    txt += `• 法定新制資遣費預估：NT$ ${report.leaveSeverance.estimatedSeverancePay.toLocaleString()} 元 (勞工退休金條例第12條)\n`;
  }

  txt += `\n【二、雇主違法事實與請求返還金額總表】\n`;
  txt += `• 違法情事總計：${report.summary.violationCount} 項\n`;
  txt += `• 預估雇主積欠與應返還總額：NT$ ${report.summary.totalClaimAmount?.toLocaleString()} 元\n`;
  txt += `-------------------------------------------------------\n`;

  if (report.allViolations && report.allViolations.length > 0) {
    report.allViolations.forEach((v, idx) => {
      txt += `\n[項目 ${idx + 1}] ${v.title}\n`;
      txt += `• 適用法條：${v.law}\n`;
      txt += `• 違法事實：${v.description}\n`;
      if (v.restitution_amount && v.restitution_amount > 0) {
        txt += `• 請求補發/返還金額：NT$ ${v.restitution_amount.toLocaleString()} 元\n`;
      }
      if (v.penalty_risk) {
        txt += `• 法定罰則風險：${v.penalty_risk}\n`;
      }
    });
  } else {
    txt += `本次體檢未檢出具體違反勞基法事項。\n`;
  }

  txt += `\n=======================================================\n`;
  txt += `【三、法律聲明與存證簽章】\n`;
  txt += `${report.legalDisclaimer || '本計算清冊依勞工提供之數據產出，作為向地方主管機關申請勞資爭議調解之佐證附件。'}\n\n`;
  txt += `申請人 (勞方簽章)：_____________________\n`;
  txt += `提出申請日期：中華民國     年     月     日\n`;
  txt += `受理調解機關 (直轄市/縣市政府勞工局)：_____________________\n`;

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `勞資爭議調解存證計算清冊_${now}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

