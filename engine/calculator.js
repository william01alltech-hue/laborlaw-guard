/**
 * 勞工守護神 (Labor Law Guard) - 核心法規計算引擎
 * 支援瀏覽器 (PWA) 與 Node.js 環境
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LaborCalculator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // 級距對照輔助函式
  function findTier(table, salary) {
    for (let i = 0; i < table.length; i++) {
      const tier = table[i];
      if (salary >= tier.salary_min && salary <= tier.salary_max) {
        return tier.insured_salary;
      }
    }
    return table[table.length - 1].insured_salary;
  }

  /**
   * 模組 1：工資母數判定與平日每小時工資額
   * @param {Object} salaryInfo 包含底薪與各項津貼
   * @param {Object} constants 法規常數表
   * @param {string} employmentType 聘僱型態 ('monthly' 或 'hourly')
   */
  function calculateWageBase(salaryInfo, constants, employmentType = 'monthly') {
    const isHourly = employmentType === 'hourly';
    const minMonthlyWage = constants.statutory_minimums.monthly_wage;
    const minHourlyWage = constants.statutory_minimums.hourly_wage || 190;
    const divisor = constants.statutory_minimums.statutory_monthly_work_hours_divisor || 240;

    const baseSalary = Number(salaryInfo.base_salary) || 0;
    const dutyAllowance = Number(salaryInfo.duty_allowance) || 0; // 職務加給
    const mealAllowance = Number(salaryInfo.meal_allowance) || 0; // 伙食津貼
    const attendanceBonus = Number(salaryInfo.attendance_bonus) || 0; // 全勤獎金
    const fixedBonus = Number(salaryInfo.fixed_bonus) || 0; // 其他經常性給與

    let totalRegularWage = 0;
    let regularHourlyWage = 0;
    let isBelowMinimumWage = false;

    if (isHourly) {
      // 時薪制：約定時薪即為平日每小時工資額 (R)
      totalRegularWage = baseSalary;
      regularHourlyWage = baseSalary;
      isBelowMinimumWage = baseSalary < minHourlyWage;
    } else {
      // 月薪制：依法全數計入經常性給與後除以 240
      totalRegularWage = baseSalary + dutyAllowance + mealAllowance + attendanceBonus + fixedBonus;
      regularHourlyWage = totalRegularWage / divisor;
      isBelowMinimumWage = totalRegularWage < minMonthlyWage;
    }

    return {
      totalRegularWage,
      regularHourlyWage,
      isBelowMinimumWage,
      minMonthlyWage,
      minHourlyWage,
      isHourly,
      regularWageBreakdown: {
        baseSalary,
        dutyAllowance,
        mealAllowance,
        attendanceBonus,
        fixedBonus
      }
    };
  }

  /**
   * 模組 2：社保合規檢查（勞保、健保、眷屬加保、勞退6%內扣）
   */
  function checkInsuranceCompliance(salaryInfo, dependentsCount, constants) {
    const totalRegularWage = salaryInfo.totalRegularWage;
    const deductions = salaryInfo.deductions || {};

    const statutoryLaborTier = findTier(constants.labor_insurance.tier_table, totalRegularWage);
    const statutoryAccidentTier = findTier(constants.occupational_accident_insurance.tier_table, totalRegularWage);
    const statutoryHealthTier = findTier(constants.health_insurance.tier_table, totalRegularWage);
    const statutoryPensionTier = findTier(constants.labor_pension.tier_table, totalRegularWage);

    const violations = [];
    let totalRestitutionAmount = 0;

    // 1. 勞退 6% 違法內扣檢查
    const pensionDeducted = Number(deductions.pension_6_percent_deducted) || 0;
    if (pensionDeducted > 0) {
      violations.push({
        id: "VIO_PENSION_INWARD",
        severity: "CRITICAL",
        law: "勞工退休金條例第14條第1項",
        title: "雇主違法將6%勞工退休金自勞工工資內扣除",
        description: `勞工退休金雇主提繳部分應由雇主全額負擔，不得自工資內扣除。本次發現內扣金額：${pensionDeducted} 元。`,
        penalty_risk: "處新臺幣二萬元以上十萬元以下罰鍰，並限期命其返還。",
        restitution_amount: pensionDeducted
      });
      totalRestitutionAmount += pensionDeducted;
    }

    // 2. 雇主法定勞退 6% 應提繳金額 vs 申報金額
    const employerStatutoryPension = statutoryPensionTier * constants.labor_pension.employer_statutory_minimum_rate;

    // 3. 健保眷屬口數檢查
    const rawDependents = Number(dependentsCount) || 0;
    const maxAllowed = constants.health_insurance.max_dependents_charged;
    const effectiveDependents = Math.min(rawDependents, maxAllowed);
    let dependentOvercharged = 0;

    if (rawDependents > maxAllowed) {
      // 依健保法，第 4 口起免收健保費
      const singlePersonHealthFee = statutoryHealthTier * constants.health_insurance.rate * constants.health_insurance.sharing_ratios.worker;
      const overcount = rawDependents - maxAllowed;
      dependentOvercharged = Math.round(singlePersonHealthFee * overcount);

      violations.push({
        id: "VIO_HEALTH_DEPENDENT_OVERCHARGE",
        severity: "HIGH",
        law: "全民健康保險法第18條第2項",
        title: "健保加保眷屬超過 3 口依法免收，疑有多計溢扣",
        description: `勞工加保眷屬 ${rawDependents} 口，法定計費上限為 ${maxAllowed} 口，超額 ${overcount} 口依法免收健保費。`,
        penalty_risk: "雇主應即刻退還溢扣之健保費。",
        restitution_amount: dependentOvercharged
      });
      totalRestitutionAmount += dependentOvercharged;
    }

    // 4. 高薪低報檢查
    const reportedLaborSalary = Number(salaryInfo.reported_labor_salary) || 0;
    let isLaborUnderreported = false;
    if (reportedLaborSalary > 0 && reportedLaborSalary < statutoryLaborTier) {
      isLaborUnderreported = true;
      violations.push({
        id: "VIO_LABOR_INSURANCE_UNDERREPORTED",
        severity: "CRITICAL",
        law: "勞工保險條例第14條、第72條",
        title: "勞工保險投保薪資以多報少（高薪低報）",
        description: `實領應稅薪資應投保級距為 ${statutoryLaborTier} 元，公司實際申報僅 ${reportedLaborSalary} 元，差距達 ${statutoryLaborTier - reportedLaborSalary} 元。`,
        penalty_risk: "依短報金額處四倍罰鍰，並負擔勞工因此所受之所有給付損失賠償責任。"
      });
    }

    return {
      statutoryTiers: {
        laborInsurance: statutoryLaborTier,
        occupationalAccident: statutoryAccidentTier,
        healthInsurance: statutoryHealthTier,
        laborPension: statutoryPensionTier
      },
      employerStatutoryPension: Math.round(employerStatutoryPension),
      effectiveDependents,
      isLaborUnderreported,
      violations,
      totalRestitutionAmount
    };
  }

  /**
   * 模組 3：雙軌加班費精密計算（月薪制本薪不重複扣，時薪制全額加給）
   */
  function calculateOvertime(records, employmentType, hourlyWage, constants) {
    const isMonthly = employmentType === 'monthly';
    const rules = isMonthly ? constants.overtime_rules.monthly_worker : constants.overtime_rules.hourly_worker;

    let totalStatutoryOvertime = 0;
    const dailyDetails = [];

    records.forEach((rec) => {
      const type = rec.day_type || 'weekday'; // weekday, rest_day, national_holiday, regular_leave
      const otHours = Number(rec.overtime_hours) || 0;
      const normalHours = Number(rec.normal_hours) || 0;
      let dayOvertimePay = 0;

      if (type === 'weekday') {
        if (otHours > 0) {
          const tier1 = Math.min(otHours, 2);
          const tier2 = Math.max(otHours - 2, 0);
          dayOvertimePay += (tier1 * hourlyWage * (4 / 3)) + (tier2 * hourlyWage * (5 / 3));
        }
      } else if (type === 'rest_day') {
        // 休息日
        const totalHours = normalHours + otHours;
        if (isMonthly) {
          // 月薪制：當日本薪已含於月薪中，僅計算額外加給
          const t1 = Math.min(totalHours, 2);
          const t2 = Math.max(Math.min(totalHours, 8) - 2, 0);
          const t3 = Math.max(totalHours - 8, 0);
          dayOvertimePay += (t1 * hourlyWage * (4 / 3)) + (t2 * hourlyWage * (5 / 3)) + (t3 * hourlyWage * (8 / 3));
        } else {
          // 時薪制：基本時薪未含假日工資，依內政部74年台內勞字第328433號函計算全額
          const t1 = Math.min(totalHours, 2);
          const t2 = Math.max(Math.min(totalHours, 8) - 2, 0);
          const t3 = Math.max(totalHours - 8, 0);
          dayOvertimePay += (t1 * hourlyWage * (4 / 3)) + (t2 * hourlyWage * (5 / 3)) + (t3 * hourlyWage * (8 / 3));
        }
      } else if (type === 'national_holiday') {
        // 國定假日出勤：前 8 小時加給一日工資
        if (normalHours > 0 || otHours > 0) {
          dayOvertimePay += (8 * hourlyWage); // 加給一日
          if (otHours > 0) {
            const t1 = Math.min(otHours, 2);
            const t2 = Math.max(otHours - 2, 0);
            dayOvertimePay += (t1 * hourlyWage * (4 / 3)) + (t2 * hourlyWage * (5 / 3));
          }
        }
      } else if (type === 'regular_leave') {
        // 例假日出勤（違法）
        if (normalHours > 0 || otHours > 0) {
          dayOvertimePay += (8 * hourlyWage); // 依法加倍發給一日並應事後補休
        }
      }

      totalStatutoryOvertime += dayOvertimePay;
      dailyDetails.push({
        date: rec.date,
        type,
        otHours,
        dayOvertimePay
      });
    });

    // 嚴格依照勞動部標準：最後總額才執行四捨五入，消除一元爭議
    return {
      totalStatutoryOvertime: Math.round(totalStatutoryOvertime),
      dailyDetails
    };
  }

  /**
   * 模組 4：工時排班合規檢驗樹（支援四週變形工時、連七判定）
   */
  function checkScheduleViolations(records, flexibleSystem, hasUnionOrMeetingConsent, constants) {
    const violations = [];
    const isFourWeek = flexibleSystem === 'four_week';

    let consecutiveWorkDays = 0;
    let monthlyOvertimeHours = 0;
    const consecutiveViolations = [];
    const dailyOvertimeViolations = [];

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const normal = Number(rec.normal_hours) || 0;
      const ot = Number(rec.overtime_hours) || 0;
      const totalDaily = normal + ot;
      monthlyOvertimeHours += ot;

      // 1. 單日超時檢驗（超過 12 小時）
      if (totalDaily > 12) {
        dailyOvertimeViolations.push({
          date: rec.date,
          totalHours: totalDaily
        });
      }

      // 2. 出勤狀態統計
      const isWorking = (normal > 0 || ot > 0) && rec.day_type !== 'regular_leave' && rec.day_type !== 'rest_day';
      if (isWorking) {
        consecutiveWorkDays++;
      } else {
        consecutiveWorkDays = 0;
      }

      // 3. 連續出勤檢驗
      if (!isFourWeek) {
        // 一般週休二日：每 7 日必須有 1 例，連續工作第 7 天即違規
        if (consecutiveWorkDays >= 7) {
          consecutiveViolations.push({
            date: rec.date,
            consecutiveDays: consecutiveWorkDays
          });
        }
      } else {
        // 四週變形工時：每 2 週 2 例，最長允許連續出勤 10 天
        if (consecutiveWorkDays > 10) {
          consecutiveViolations.push({
            date: rec.date,
            consecutiveDays: consecutiveWorkDays
          });
        }
      }
    }

    // 整理單日超時違規
    if (dailyOvertimeViolations.length > 0) {
      violations.push({
        id: "VIO_DAILY_HOURS_OVER12",
        severity: "CRITICAL",
        law: "勞動基準法第32條第2項",
        title: "一日工作總工時超過法定 12 小時上限",
        description: `共有 ${dailyOvertimeViolations.length} 日工作時間超過 12 小時上限。`,
        occurred_dates: dailyOvertimeViolations.map(d => `${d.date} (${d.totalHours}小時)`),
        penalty_risk: "處新臺幣二萬元以上一百萬元以下罰鍰。"
      });
    }

    // 整理連續出勤違規
    if (consecutiveViolations.length > 0) {
      const title = isFourWeek ? "四週變形工時連續出勤超過法定上限（10天）" : "一例一休違規：連續工作超過 6 日未給例假";
      violations.push({
        id: "VIO_CONSECUTIVE_WORK_LIMIT",
        severity: "CRITICAL",
        law: "勞動基準法第36條",
        title: title,
        description: `勞工出現連續出勤未給例假情事，最高連續出勤達 ${Math.max(...consecutiveViolations.map(c => c.consecutiveDays))} 天。`,
        occurred_dates: consecutiveViolations.map(c => c.date),
        penalty_risk: "處新臺幣二萬元以上一百萬元以下罰鍰。"
      });
    }

    // 4. 單月加班總時數檢驗
    const statutoryMonthlyLimit = hasUnionOrMeetingConsent ? 54 : 46;
    if (monthlyOvertimeHours > statutoryMonthlyLimit) {
      violations.push({
        id: "VIO_MONTHLY_OVERTIME_LIMIT",
        severity: "CRITICAL",
        law: "勞動基準法第32條第2項",
        title: `全月延長工時超過法定上限（實施 ${monthlyOvertimeHours} 小時，上限 ${statutoryMonthlyLimit} 小時）`,
        description: hasUnionOrMeetingConsent 
          ? `已宣稱經工會或勞資會議同意，但全月加班時數仍超過法定極限 54 小時。`
          : `未經工會或勞資會議同意時，每月加班時數不得超過 46 小時。若公司無合法會議紀錄即屬違法。`,
        penalty_risk: "處新臺幣二萬元以上一百萬元以下罰鍰。"
      });
    }

    return {
      monthlyOvertimeHours,
      violations
    };
  }

  /**
   * 模組 5：特休折算與資遣費推算（分流兩種工資母數）
   */
  function calculateSpecialLeaveSeverance(hireDateStr, checkDateStr, regularHourlyWage, averageMonthlyWage, constants) {
    const hireDate = new Date(hireDateStr);
    const checkDate = new Date(checkDateStr);

    let months = (checkDate.getFullYear() - hireDate.getFullYear()) * 12 + (checkDate.getMonth() - hireDate.getMonth());
    if (checkDate.getDate() < hireDate.getDate()) months--;
    if (months < 0) months = 0;

    // 特休天數計算
    let statutoryLeaveDays = 0;
    for (const tier of constants.special_leave_rules.tenure_tiers) {
      if (months >= tier.min_months && months <= tier.max_months) {
        if (tier.days !== undefined) {
          statutoryLeaveDays = tier.days;
        } else {
          const extraYears = Math.floor((months - tier.min_months) / 12);
          statutoryLeaveDays = Math.min(tier.base_days + extraYears * tier.add_day_per_year, tier.max_days);
        }
        break;
      }
    }

    // 未休特休代金：母數採「正常平日工資額」
    const specialLeaveDailyPay = regularHourlyWage * 8;
    const estimatedFullLeaveCashout = Math.round(statutoryLeaveDays * specialLeaveDailyPay);

    // 資遣費推算：母數採勞基法第2條第4款「平均工資（含加班費）」
    const years = months / 12;
    // 勞工退休金條例第12條：每滿一年發給 0.5 個月平均工資，最高以 6 個月為限
    const severanceBaseMonths = Math.min(years * 0.5, 6);
    const estimatedSeverancePay = Math.round(severanceBaseMonths * averageMonthlyWage);

    return {
      tenureMonths: months,
      tenureYears: (months / 12).toFixed(1),
      statutoryLeaveDays,
      specialLeaveDailyPay: Math.round(specialLeaveDailyPay),
      estimatedFullLeaveCashout,
      estimatedSeverancePay
    };
  }

  /**
   * 模組 6：綜合診斷報告產生器
   */
  function generateDiagnosticReport(input, constants) {
    const isHourly = input.employment_type === 'hourly';

    // 1. 計算工資母數
    const wageBase = calculateWageBase(input.salary_info, constants, input.employment_type);

    // 2. 檢查社保與勞退合規
    const targetWageForInsurance = isHourly
      ? (Number(input.salary_info.reported_labor_salary) || constants.statutory_minimums.monthly_wage)
      : wageBase.totalRegularWage;

    const insuranceComp = checkInsuranceCompliance({
      totalRegularWage: targetWageForInsurance,
      reported_labor_salary: input.salary_info.reported_labor_salary,
      deductions: input.salary_info.deductions
    }, input.dependents_count, constants);

    // 3. 計算加班費
    const overtimeComp = calculateOvertime(
      input.schedule_records || [],
      input.employment_type || 'monthly',
      wageBase.regularHourlyWage,
      constants
    );

    // 4. 檢查排班合規
    const scheduleComp = checkScheduleViolations(
      input.schedule_records || [],
      input.flexible_system || 'standard',
      input.has_union_or_meeting_consent || false,
      constants
    );

    // 5. 特休與資遣費試算
    const leaveSeverance = calculateSpecialLeaveSeverance(
      input.hire_date,
      input.check_date || new Date().toISOString().split('T')[0],
      wageBase.regularHourlyWage,
      input.average_monthly_wage || wageBase.totalRegularWage,
      constants
    );

    // 6. 計算加班費短少金額
    const actualOvertimePaid = Number(input.salary_info.actual_overtime_paid) || 0;
    const overtimeUnderpaid = Math.max(overtimeComp.totalStatutoryOvertime - actualOvertimePaid, 0);

    const allViolations = [
      ...insuranceComp.violations,
      ...scheduleComp.violations
    ];

    if (overtimeUnderpaid > 0) {
      allViolations.push({
        id: "VIO_OVERTIME_UNDERPAID",
        severity: "HIGH",
        law: "勞動基準法第24條",
        title: "加班費少給或未足額發給",
        description: `本月法定應得加班費為 ${overtimeComp.totalStatutoryOvertime} 元，公司實發 ${actualOvertimePaid} 元，短少 ${overtimeUnderpaid} 元。`,
        penalty_risk: "處新臺幣二萬元以上一百萬元以下罰鍰。",
        restitution_amount: overtimeUnderpaid
      });
    }

    if (wageBase.isBelowMinimumWage) {
      const desc = isHourly
        ? `約定時薪僅 ${wageBase.regularHourlyWage} 元，低於中央主管機關公告之法定基本時薪 ${wageBase.minHourlyWage} 元。`
        : `實領經常性工資總額僅 ${wageBase.totalRegularWage} 元，低於中央主管機關公告之法定基本工資 ${wageBase.minMonthlyWage} 元。`;

      allViolations.push({
        id: "VIO_BELOW_MINIMUM_WAGE",
        severity: "CRITICAL",
        law: "勞動基準法第21條",
        title: isHourly ? "約定時薪低於法定最低基本時薪" : "約定經常性工資低於法定最低基本工資",
        description: desc,
        penalty_risk: "處新臺幣二萬元以上一百萬元以下罰鍰。"
      });
    }

    // 總短少與返還請求金額
    const totalClaimAmount = insuranceComp.totalRestitutionAmount + overtimeUnderpaid;

    // 綜合風險等級評定
    let riskLevel = "LOW";
    if (allViolations.some(v => v.severity === "CRITICAL")) {
      riskLevel = "CRITICAL";
    } else if (allViolations.some(v => v.severity === "HIGH")) {
      riskLevel = "HIGH";
    }

    return {
      summary: {
        riskLevel,
        totalClaimAmount,
        violationCount: allViolations.length,
        regularHourlyWage: Math.round(wageBase.regularHourlyWage),
        totalRegularWage: wageBase.totalRegularWage
      },
      wageBase,
      insuranceComp,
      overtimeComp,
      scheduleComp,
      leaveSeverance,
      allViolations,
      legalDisclaimer: "⚖️ 本計算清冊內容係依勞工單方自行輸入之出勤與薪資紀錄進行法規程式試算，未經地方勞工行政主管機關或司法機關正式調查認定前，不具最終行政處分效力。使用者如擅自對外散布涉及特定企業名譽者，應自負相關法律責任。"
    };
  }

  return {
    calculateWageBase,
    checkInsuranceCompliance,
    calculateOvertime,
    checkScheduleViolations,
    calculateSpecialLeaveSeverance,
    generateDiagnosticReport
  };
}));
