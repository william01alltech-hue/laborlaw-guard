const fs = require('fs');
const path = require('path');
const LaborCalculator = require('../engine/calculator.js');

const constantsPath = path.join(__dirname, '../constants/labor_constants.json');
const constants = JSON.parse(fs.readFileSync(constantsPath, 'utf8'));

console.log('🧪 開始執行核心計算引擎 (calculator.js) 壓力測試...\n');

let failedTests = 0;

// 測試案例 1：典型受害勞工情境
// 月薪總計 35,000 元（底薪 26,000 + 全勤 3,000 + 伙食 3,000 + 職務加給 3,000）
// 公司違規：
// 1. 勞保申報僅 27,470 元（實應申報 36,300 元）-> 高薪低報
// 2. 薪資單內扣 6% 勞退金 2,100 元 -> 違法內扣
// 3. 平日加班 10 小時，公司用底薪 26,000 算發給 1,444 元，法定應按 35,000 算發給 1,944 元 -> 短少 500 元
// 4. 連續上班 8 天未給例假 -> 違法連八
const testCase1 = {
  employment_type: 'monthly',
  hire_date: '2023-01-01',
  check_date: '2026-01-01', // 滿 3 年
  average_monthly_wage: 35000,
  dependents_count: 1,
  salary_info: {
    base_salary: 26000,
    attendance_bonus: 3000,
    meal_allowance: 3000,
    duty_allowance: 3000,
    reported_labor_salary: 27470,
    actual_overtime_paid: 1444,
    deductions: {
      pension_6_percent_deducted: 2100
    }
  },
  schedule_records: [
    { date: '2026-03-01', day_type: 'weekday', normal_hours: 8, overtime_hours: 2 },
    { date: '2026-03-02', day_type: 'weekday', normal_hours: 8, overtime_hours: 2 },
    { date: '2026-03-03', day_type: 'weekday', normal_hours: 8, overtime_hours: 2 },
    { date: '2026-03-04', day_type: 'weekday', normal_hours: 8, overtime_hours: 2 },
    { date: '2026-03-05', day_type: 'weekday', normal_hours: 8, overtime_hours: 2 },
    { date: '2026-03-06', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-07', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-08', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 } // 連上 8 天
  ]
};

const report1 = LaborCalculator.generateDiagnosticReport(testCase1, constants);

// 檢驗案例 1
const hasPensionViolation = report1.allViolations.some(v => v.id === 'VIO_PENSION_INWARD');
const hasLaborUnderreported = report1.allViolations.some(v => v.id === 'VIO_LABOR_INSURANCE_UNDERREPORTED');
const hasConsecutiveViolation = report1.allViolations.some(v => v.id === 'VIO_CONSECUTIVE_WORK_LIMIT');
const hasOvertimeUnderpaid = report1.allViolations.some(v => v.id === 'VIO_OVERTIME_UNDERPAID');

if (hasPensionViolation && hasLaborUnderreported && hasConsecutiveViolation && hasOvertimeUnderpaid) {
  console.log('✅ [PASS] 案例 1 (典型受害勞工)：成功全數抓出 4 項重大違法（勞退內扣、高薪低報、連上八天、加班費短少）');
  console.log(`   - 總求償金額：$${report1.summary.totalClaimAmount} 元 (勞退返還: $${report1.insuranceComp.totalRestitutionAmount} + 加班費差額: $${report1.allViolations.find(v => v.id === 'VIO_OVERTIME_UNDERPAID').restitution_amount})`);
} else {
  failedTests++;
  console.error('❌ [FAIL] 案例 1 檢驗未全數抓出違規：', {
    hasPensionViolation,
    hasLaborUnderreported,
    hasConsecutiveViolation,
    hasOvertimeUnderpaid
  });
}

// 測試案例 2：餐飲業四週變形工時合規測試（連上 8 天，但在四週變形許可的 10 天內）
const testCase2 = {
  ...testCase1,
  flexible_system: 'four_week', // 指定為四週變形工時
  schedule_records: [
    { date: '2026-03-01', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-02', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-03', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-04', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-05', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-06', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-07', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 },
    { date: '2026-03-08', day_type: 'weekday', normal_hours: 8, overtime_hours: 0 }, // 連上 8 天
    { date: '2026-03-09', day_type: 'regular_leave', normal_hours: 0, overtime_hours: 0 }
  ]
};

const report2 = LaborCalculator.generateDiagnosticReport(testCase2, constants);
const falseConsecutiveAlarm = report2.allViolations.some(v => v.id === 'VIO_CONSECUTIVE_WORK_LIMIT');

if (!falseConsecutiveAlarm) {
  console.log('✅ [PASS] 案例 2 (四週變形工時)：連上 8 天在法定 10 天許可範圍內，引擎正確判定合規，杜絕誤報！');
} else {
  failedTests++;
  console.error('❌ [FAIL] 案例 2 四週變形工時誤報連七違規！');
}

// 測試案例 3：時薪制（工讀生）休息日加班費測試
// 時薪 200 元，休息日出勤 4 小時
const hourlyCase = {
  employment_type: 'hourly',
  hire_date: '2025-06-01',
  average_monthly_wage: 20000,
  salary_info: {
    base_salary: 200 * 240, // 模擬時薪
    reported_labor_salary: 28590
  },
  schedule_records: [
    { date: '2026-03-07', day_type: 'rest_day', normal_hours: 0, overtime_hours: 4 }
  ]
};

const hourlyOvertime = LaborCalculator.calculateOvertime(
  hourlyCase.schedule_records,
  'hourly',
  200,
  constants
);

// 4小時 = 前2小時 (2 * 200 * 4/3) + 後2小時 (2 * 200 * 5/3) = 533.33 + 666.67 = 1200
if (hourlyOvertime.totalStatutoryOvertime === 1200) {
  console.log(`✅ [PASS] 案例 3 (時薪工讀生休息日出勤)：時薪 200 出勤 4 小時，依法精確給付 $${hourlyOvertime.totalStatutoryOvertime} 元`);
} else {
  failedTests++;
  console.error(`❌ [FAIL] 案例 3 時薪計算有誤，預期 1200，實際: ${hourlyOvertime.totalStatutoryOvertime}`);
}

// 測試案例 4：特休年資與資遣費推算（滿3年）
const tenureComp = LaborCalculator.calculateSpecialLeaveSeverance(
  '2023-01-01',
  '2026-01-01',
  150, // 每小時工資額
  36000, // 平均月工資
  constants
);

// 滿 3 年依法特休 14 天，未休代金 = 14 * 150 * 8 = 16,800 元
// 新制資遣費 = 3年 * 0.5 * 36,000 = 54,000 元
if (tenureComp.statutoryLeaveDays === 14 && tenureComp.estimatedFullLeaveCashout === 16800 && tenureComp.estimatedSeverancePay === 54000) {
  console.log(`✅ [PASS] 案例 4 (特休與資遣費推算)：滿 3 年法定特休 ${tenureComp.statutoryLeaveDays} 天 (代金 $${tenureComp.estimatedFullLeaveCashout})，資遣費預估 $${tenureComp.estimatedSeverancePay} 元`);
} else {
  failedTests++;
  console.error('❌ [FAIL] 案例 4 特休或資遣費推算有誤:', tenureComp);
}

// 測試案例 5：時薪制完整診斷報告（時薪 200 元合規 vs 時薪 180 元違規檢驗）
const hourlyDiagCase = {
  employment_type: 'hourly',
  hire_date: '2024-01-01',
  salary_info: {
    base_salary: 200,
    reported_labor_salary: 28590
  },
  schedule_records: [
    { date: '2026-03-01', day_type: 'weekday', normal_hours: 8, overtime_hours: 2 }
  ]
};

const hourlyReport = LaborCalculator.generateDiagnosticReport(hourlyDiagCase, constants);
const falseBelowMinWage = hourlyReport.allViolations.some(v => v.id === 'VIO_BELOW_MINIMUM_WAGE');

// 測試時薪 180 低於法定 190
const subMinHourlyCase = {
  employment_type: 'hourly',
  hire_date: '2024-01-01',
  salary_info: {
    base_salary: 180
  },
  schedule_records: []
};
const subMinReport = LaborCalculator.generateDiagnosticReport(subMinHourlyCase, constants);
const correctlyCaughtSubMin = subMinReport.allViolations.some(v => v.id === 'VIO_BELOW_MINIMUM_WAGE');

if (!falseBelowMinWage && correctlyCaughtSubMin) {
  console.log(`✅ [PASS] 案例 5 (時薪制綜合診斷)：時薪 200 正確判定合規，時薪 180 精準捕獲違法基本時薪！`);
} else {
  failedTests++;
  console.error('❌ [FAIL] 案例 5 時薪制綜合診斷邏輯有誤！');
}

if (failedTests === 0) {
  console.log('\n🎉 計算引擎五大模組全部通過極限測試，精度與實務邏輯 100% 吻合！');
  process.exit(0);
} else {
  console.error(`\n⚠️ 共有 ${failedTests} 項測試失敗！`);
  process.exit(1);
}
