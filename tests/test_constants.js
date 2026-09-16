const fs = require('fs');
const path = require('path');

// 載入常數表
const constantsPath = path.join(__dirname, '../constants/labor_constants.json');
const constants = JSON.parse(fs.readFileSync(constantsPath, 'utf8'));

console.log(`[PASS] 成功載入勞動法規常數版本: ${constants.version}, 生效日期: ${constants.effective_date}`);

// 級距查詢輔助函式
function findTier(table, salary) {
  for (const tier of table) {
    if (salary >= tier.salary_min && salary <= tier.salary_max) {
      return tier.insured_salary;
    }
  }
  return table[table.length - 1].insured_salary;
}

// 測試案例矩陣
const testCases = [
  {
    name: "基本工資（28,590元）邊界測試",
    salary: 28590,
    expected: {
      labor_insurance: 28590,
      occupational_accident: 28590,
      health_insurance: 28590,
      labor_pension: 28590
    }
  },
  {
    name: "中階薪資（38,000元）級距對齊測試",
    salary: 38000,
    expected: {
      labor_insurance: 38200,
      occupational_accident: 38200,
      health_insurance: 38200,
      labor_pension: 38200
    }
  },
  {
    name: "高薪破勞保上限（50,000元）測試",
    salary: 50000,
    expected: {
      labor_insurance: 45800, // 勞保封頂 45,800
      occupational_accident: 50600, // 災保獨立級距
      health_insurance: 50600,
      labor_pension: 50600
    }
  },
  {
    name: "超高薪資（80,000元）各項封頂邊界測試",
    salary: 80000,
    expected: {
      labor_insurance: 45800, // 勞保封頂 45,800
      occupational_accident: 72800, // 災保最高上限 72,800
      health_insurance: 80200,
      labor_pension: 80200
    }
  }
];

let failed = 0;

testCases.forEach((tc) => {
  const actualLI = findTier(constants.labor_insurance.tier_table, tc.salary);
  const actualOA = findTier(constants.occupational_accident_insurance.tier_table, tc.salary);
  const actualHI = findTier(constants.health_insurance.tier_table, tc.salary);
  const actualLP = findTier(constants.labor_pension.tier_table, tc.salary);

  const passedLI = actualLI === tc.expected.labor_insurance;
  const passedOA = actualOA === tc.expected.occupational_accident;
  const passedHI = actualHI === tc.expected.health_insurance;
  const passedLP = actualLP === tc.expected.labor_pension;

  if (passedLI && passedOA && passedHI && passedLP) {
    console.log(`✅ [PASS] ${tc.name} -> 勞保:${actualLI}, 災保:${actualOA}, 健保:${actualHI}, 勞退:${actualLP}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${tc.name}:`);
    if (!passedLI) console.error(`   勞保預期 ${tc.expected.labor_insurance}，實際 ${actualLI}`);
    if (!passedOA) console.error(`   災保預期 ${tc.expected.occupational_accident}，實際 ${actualOA}`);
    if (!passedHI) console.error(`   健保預期 ${tc.expected.health_insurance}，實際 ${actualHI}`);
    if (!passedLP) console.error(`   勞退預期 ${tc.expected.labor_pension}，實際 ${actualLP}`);
  }
});

// 測試健保眷屬上限截斷邏輯
const dependentsInput = 5;
const effectiveDependents = Math.min(dependentsInput, constants.health_insurance.max_dependents_charged);
if (effectiveDependents === 3) {
  console.log(`✅ [PASS] 健保眷屬口數上限測試：輸入 ${dependentsInput} 口，依法正確截斷至 ${effectiveDependents} 口`);
} else {
  failed++;
  console.error(`❌ [FAIL] 健保眷屬口數上限測試未通過，實際值: ${effectiveDependents}`);
}

// 測試特休計算
function calculateSpecialLeave(months) {
  for (const tier of constants.special_leave_rules.tenure_tiers) {
    if (months >= tier.min_months && months <= tier.max_months) {
      if (tier.days !== undefined) return tier.days;
      const extraYears = Math.floor((months - tier.min_months) / 12);
      return Math.min(tier.base_days + extraYears * tier.add_day_per_year, tier.max_days);
    }
  }
  return 0;
}

const leave6m = calculateSpecialLeave(6);
const leave1y = calculateSpecialLeave(12);
const leave3y = calculateSpecialLeave(36);
const leave10y = calculateSpecialLeave(120);

if (leave6m === 3 && leave1y === 7 && leave3y === 14 && leave10y === 15) {
  console.log(`✅ [PASS] 特休天數計算驗證：6個月=${leave6m}天, 1年=${leave1y}天, 3年=${leave3y}天, 10年=${leave10y}天`);
} else {
  failed++;
  console.error(`❌ [FAIL] 特休天數計算有誤: 6m=${leave6m}, 1y=${leave1y}, 3y=${leave3y}, 10y=${leave10y}`);
}

if (failed === 0) {
  console.log('\n🎉 所有法規常數與級距邏輯測試全部通過！');
  process.exit(0);
} else {
  console.error(`\n⚠️ 共有 ${failed} 項測試失敗，請檢查！`);
  process.exit(1);
}
