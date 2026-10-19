/**
 * CSV Import & Export utilities for SleepIn Web.
 * Mirrors CsvCodec, CsvImporter, CsvExporter, ScheduleCsvImporter, ScheduleCsvExporter.
 */

// ---------------- CSV Codec ----------------
export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function encodeCsvField(field) {
  if (field == null) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ---------------- Course CSV Import & Export ----------------
export function parseCourseCsv(rawCsv, totalWeeks, maxPeriod) {
  const normalized = rawCsv.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ rowNumber: 1, message: 'CSV 文件为空' }] };
  }

  const header = parseCsvLine(lines[0]).map(h => h.trim());
  const headerMap = {};
  header.forEach((h, idx) => { headerMap[h] = idx; });

  const rows = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1;
    const fields = parseCsvLine(lines[i]);

    try {
      const getVal = (...keys) => {
        for (const k of keys) {
          if (headerMap[k] != null) {
            return (fields[headerMap[k]] || '').trim();
          }
        }
        throw new Error(`缺少表头列: ${keys.join('/')}`);
      };

      const name = getVal('课程名称', 'CourseName');
      if (!name) throw new Error('课程名称不能为空');

      const teacher = getVal('教师', 'Teacher');
      const location = getVal('地点', 'Location');

      const dayOfWeek = parseInt(getVal('星期', 'DayOfWeek'), 10);
      if (isNaN(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
        throw new Error('星期必须为 1 到 7 之间的整数');
      }

      const startPeriod = parseInt(getVal('开始节次', 'StartPeriod'), 10);
      const endPeriod = parseInt(getVal('结束节次', 'EndPeriod'), 10);
      if (isNaN(startPeriod) || isNaN(endPeriod) || startPeriod < 1 || endPeriod > maxPeriod || startPeriod > endPeriod) {
        throw new Error(`节次范围必须在 1 到 ${maxPeriod} 之间且开始节次 ≤ 结束节次`);
      }

      // Check for '周次' or 'Weeks'
      const hasWeeksCol = (headerMap['周次'] != null || headerMap['Weeks'] != null);
      let weekParseResult;

      if (hasWeeksCol) {
        const weeksSpec = getVal('周次', 'Weeks');
        weekParseResult = parseWeeksSpec(weeksSpec, totalWeeks);
      } else {
        const weekTypeRaw = getVal('周数类型', 'WeekType');
        const startWeekRaw = getVal('起始周', 'StartWeek');
        const endWeekRaw = getVal('结束周', 'EndWeek');
        const customWeeksRaw = getVal('自定义周', 'CustomWeeks');
        weekParseResult = parseLegacyWeekColumns(weekTypeRaw, startWeekRaw, endWeekRaw, customWeeksRaw, totalWeeks);
      }

      rows.push({
        name,
        teacher,
        location,
        dayOfWeek,
        startPeriod,
        endPeriod,
        weekType: weekParseResult.weekType,
        startWeek: weekParseResult.startWeek,
        endWeek: weekParseResult.endWeek,
        customWeeks: weekParseResult.customWeeks
      });
    } catch (err) {
      errors.push({ rowNumber, message: err.message });
    }
  }

  return { rows, errors };
}

function parseWeeksSpec(spec, totalWeeks) {
  const norm = spec
    .trim()
    .replace(/[，,；]/g, ';')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/周/g, '');
  if (!norm) throw new Error('周次不能为空');
  if (norm.toUpperCase() === 'ALL') {
    return { weekType: 'ALL', startWeek: null, endWeek: null, customWeeks: [] };
  }

  const rangePattern = /^\s*(\d+)\s*-\s*(\d+)\s*$/;
  const parityRangePattern = /^\s*(\d+)\s*-\s*(\d+)\s*\((odd|even|单|双)\)\s*$/i;

  if (!norm.includes(';')) {
    const rangeMatch = norm.match(rangePattern);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start < 1 || end > totalWeeks || start > end) {
        throw new Error(`周数范围无效: ${start}-${end} (总周数 1-${totalWeeks})`);
      }
      return { weekType: 'RANGE', startWeek: start, endWeek: end, customWeeks: [] };
    }
  }

  // Tokens separated by ';'
  const tokens = norm.split(';').map(t => t.trim()).filter(Boolean);
  const customSet = new Set();

  for (const token of tokens) {
    const pMatch = token.match(parityRangePattern);
    if (pMatch) {
      const start = parseInt(pMatch[1], 10);
      const end = parseInt(pMatch[2], 10);
      if (start < 1 || end > totalWeeks || start > end) {
        throw new Error(`周数范围无效: ${token}`);
      }
      const rawParity = pMatch[3].toLowerCase();
      const isOdd = (rawParity === 'odd' || rawParity === '单');
      for (let w = start; w <= end; w++) {
        if ((isOdd && w % 2 === 1) || (!isOdd && w % 2 === 0)) {
          customSet.add(w);
        }
      }
      continue;
    }

    const rMatch = token.match(rangePattern);
    if (rMatch) {
      const start = parseInt(rMatch[1], 10);
      const end = parseInt(rMatch[2], 10);
      if (start < 1 || end > totalWeeks || start > end) {
        throw new Error(`周数范围无效: ${token}`);
      }
      for (let w = start; w <= end; w++) {
        customSet.add(w);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      const single = parseInt(token, 10);
      if (single >= 1 && single <= totalWeeks) {
        customSet.add(single);
        continue;
      }
    }

    throw new Error(`无法识别或超出范围的周次配置: "${token}"`);
  }

  if (customSet.size === 0) {
    throw new Error(`周次配置未包含有效周数: "${spec}"`);
  }

  const sortedCustom = Array.from(customSet).sort((a, b) => a - b);
  return { weekType: 'CUSTOM', startWeek: null, endWeek: null, customWeeks: sortedCustom };
}

function parseLegacyWeekColumns(typeRaw, startRaw, endRaw, customRaw, totalWeeks) {
  const type = (typeRaw || 'ALL').toUpperCase();
  if (type === 'RANGE') {
    const start = parseInt(startRaw, 10) || 1;
    const end = parseInt(endRaw, 10) || totalWeeks;
    return { weekType: 'RANGE', startWeek: start, endWeek: end, customWeeks: [] };
  } else if (type === 'CUSTOM') {
    const custom = (customRaw || '').split(/[;,]/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    return { weekType: 'CUSTOM', startWeek: null, endWeek: null, customWeeks: custom };
  }
  return { weekType: 'ALL', startWeek: null, endWeek: null, customWeeks: [] };
}

export function exportCourseCsv(coursesWithSessions, totalWeeks) {
  const rows = [
    ['课程名称', '教师', '地点', '星期', '开始节次', '结束节次', '周次'].map(encodeCsvField).join(',')
  ];

  for (const item of coursesWithSessions) {
    const { course, sessions } = item;
    for (const sess of sessions) {
      let weeksSpec = `1-${totalWeeks}`;
      if (sess.weekType === 'RANGE') {
        weeksSpec = `${sess.startWeek || 1}-${sess.endWeek || totalWeeks}`;
      } else if (sess.weekType === 'CUSTOM') {
        weeksSpec = [...(sess.customWeeks || [])].sort((a, b) => a - b).join(';');
      }

      const fields = [
        course.name,
        course.teacher || '',
        sess.location || '',
        sess.dayOfWeek,
        sess.startPeriod,
        sess.endPeriod,
        weeksSpec
      ].map(encodeCsvField);

      rows.push(fields.join(','));
    }
  }

  return '\uFEFF' + rows.join('\n');
}

// ---------------- Schedule CSV Import & Export ----------------
export function parseScheduleCsv(rawCsv) {
  const normalized = rawCsv.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    return { scheduleName: '', periods: [], errors: [{ rowNumber: 1, message: 'CSV 文件为空' }] };
  }

  const header = parseCsvLine(lines[0]).map(h => h.trim());
  const headerMap = {};
  header.forEach((h, idx) => { headerMap[h] = idx; });

  const periods = [];
  const errors = [];
  let scheduleName = '';

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1;
    const fields = parseCsvLine(lines[i]);

    try {
      const getVal = (...keys) => {
        for (const k of keys) {
          if (headerMap[k] != null) return (fields[headerMap[k]] || '').trim();
        }
        throw new Error(`缺少表头列: ${keys.join('/')}`);
      };

      const name = getVal('作息表名称', 'ScheduleName');
      if (!name) throw new Error('作息表名称不能为空');
      if (!scheduleName) scheduleName = name;
      else if (scheduleName !== name) {
        throw new Error('单个 CSV 文件只能包含一个作息表名称');
      }

      const periodNumber = parseInt(getVal('节次', 'PeriodNumber'), 10);
      if (isNaN(periodNumber) || periodNumber <= 0) {
        throw new Error('节次必须大于 0');
      }

      const startTime = getVal('开始时间', 'StartTime');
      const endTime = getVal('结束时间', 'EndTime');

      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        throw new Error('时间格式必须为 HH:mm');
      }
      if (startTime >= endTime) {
        throw new Error('结束时间必须晚于开始时间');
      }

      periods.push({ periodNumber, startTime, endTime });
    } catch (err) {
      errors.push({ rowNumber, message: err.message });
    }
  }

  periods.sort((a, b) => a.periodNumber - b.periodNumber);
  return { scheduleName, periods, errors };
}

export function exportScheduleCsv(scheduleName, periods) {
  const rows = [
    ['作息表名称', '节次', '开始时间', '结束时间'].map(encodeCsvField).join(',')
  ];

  const sortedPeriods = [...periods].sort((a, b) => a.periodNumber - b.periodNumber);
  for (const p of sortedPeriods) {
    rows.push([scheduleName, p.periodNumber, p.startTime, p.endTime].map(encodeCsvField).join(','));
  }

  return '\uFEFF' + rows.join('\n');
}
