/**
 * CSV Import & Export utilities for SleepIn Web.
 * Mirrors CsvCodec, CsvImporter, CsvExporter, ScheduleCsvImporter, ScheduleCsvExporter.
 */

import { formatSessionWeeks } from './conflict.js';

export const COURSE_CSV_HEADERS = Object.freeze([
  '课程名称', '教师', '地点', '星期', '开始节次', '结束节次', '周次'
]);

const SCHEDULE_CSV_HEADERS = Object.freeze([
  '作息表名称', '节次', '开始时间', '结束时间'
]);

// ---------------- CSV Codec ----------------
export function parseCsvLine(line) {
  const rows = parseCsvRecords(line);
  return rows[0] || [];
}

/**
 * Quote-aware RFC 4180 CSV parser supporting newlines inside quoted fields.
 */
export function parseCsvRecords(rawCsv) {
  const normalized = String(rawCsv || '').replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && normalized[i + 1] === '\n') {
        i++;
      }
      row.push(current);
      if (row.some(cell => cell.trim().length > 0)) {
        records.push(row);
      }
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some(cell => cell.trim().length > 0)) {
    records.push(row);
  }

  return records;
}

export function encodeCsvField(field) {
  if (field == null) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers, rowArrays) {
  const lines = [headers.map(encodeCsvField).join(',')];
  for (const row of rowArrays) {
    lines.push(row.map(encodeCsvField).join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

function parseCsvTable(rawCsv, rowHandler) {
  const records = parseCsvRecords(rawCsv);
  if (records.length === 0) {
    return { errors: [{ rowNumber: 1, message: 'CSV 文件为空' }] };
  }

  const headerMap = {};
  records[0].forEach((h, idx) => {
    headerMap[h.trim()] = idx;
  });

  const errors = [];
  for (let i = 1; i < records.length; i++) {
    const rowNumber = i + 1;
    const fields = records[i];
    const getVal = (...keys) => {
      for (const k of keys) {
        if (headerMap[k] != null) {
          return (fields[headerMap[k]] || '').trim();
        }
      }
      throw new Error(`缺少表头列: ${keys.join('/')}`);
    };

    try {
      rowHandler(getVal, headerMap, rowNumber);
    } catch (err) {
      errors.push({ rowNumber, message: err.message });
    }
  }

  return { errors };
}

// ---------------- Week Specification Parsing & Validation ----------------
function assertValidWeekRange(start, end, totalWeeks, label = `${start}-${end}`) {
  if (isNaN(start) || isNaN(end) || start < 1 || end > totalWeeks || start > end) {
    throw new Error(`周数范围无效: ${label} (有效周数 1-${totalWeeks})`);
  }
}

export function parseWeeksSpec(spec, totalWeeks) {
  const norm = String(spec || '')
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
  const tokens = norm.split(';').map(t => t.trim()).filter(Boolean);

  if (tokens.length === 1) {
    const singleRangeMatch = tokens[0].match(rangePattern);
    if (singleRangeMatch) {
      const start = parseInt(singleRangeMatch[1], 10);
      const end = parseInt(singleRangeMatch[2], 10);
      assertValidWeekRange(start, end, totalWeeks, tokens[0]);
      return { weekType: 'RANGE', startWeek: start, endWeek: end, customWeeks: [] };
    }
  }

  const customSet = new Set();
  for (const token of tokens) {
    const pMatch = token.match(parityRangePattern);
    if (pMatch) {
      const start = parseInt(pMatch[1], 10);
      const end = parseInt(pMatch[2], 10);
      assertValidWeekRange(start, end, totalWeeks, token);
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
      assertValidWeekRange(start, end, totalWeeks, token);
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
    assertValidWeekRange(start, end, totalWeeks);
    return { weekType: 'RANGE', startWeek: start, endWeek: end, customWeeks: [] };
  }
  if (type === 'CUSTOM') {
    const custom = (customRaw || '')
      .split(/[;,]/)
      .map(n => parseInt(n.trim(), 10))
      .filter(n => !isNaN(n) && n >= 1 && n <= totalWeeks);
    if (custom.length === 0) {
      throw new Error('自定义周未包含有效周数');
    }
    return { weekType: 'CUSTOM', startWeek: null, endWeek: null, customWeeks: custom };
  }
  return { weekType: 'ALL', startWeek: null, endWeek: null, customWeeks: [] };
}

/**
 * Validates and normalizes a single course record object (used by both CSV import and OCR table import).
 */
export function validateAndBuildCourseRow(record, totalWeeks, maxPeriod) {
  const name = String(record.name || '').trim();
  if (!name) throw new Error('课程名称不能为空');

  const teacher = String(record.teacher || '').trim();
  const location = String(record.location || '').trim();

  const dayOfWeek = parseInt(record.dayOfWeek, 10);
  if (isNaN(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    throw new Error('星期必须为 1 到 7 之间的整数');
  }

  const startPeriod = parseInt(record.startPeriod, 10);
  const endPeriod = parseInt(record.endPeriod, 10);
  if (isNaN(startPeriod) || isNaN(endPeriod) || startPeriod < 1 || endPeriod > maxPeriod || startPeriod > endPeriod) {
    throw new Error(`节次范围必须在 1 到 ${maxPeriod} 之间且开始节次 ≤ 结束节次`);
  }

  const weekParseResult = record.weekParseResult || parseWeeksSpec(record.weeks, totalWeeks);

  return {
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
  };
}

// ---------------- Course CSV Import & Export ----------------
export function parseCourseCsv(rawCsv, totalWeeks, maxPeriod) {
  const rows = [];
  const { errors } = parseCsvTable(rawCsv, (getVal, headerMap) => {
    const hasWeeksCol = (headerMap['周次'] != null || headerMap['Weeks'] != null);
    const weekParseResult = hasWeeksCol
      ? parseWeeksSpec(getVal('周次', 'Weeks'), totalWeeks)
      : parseLegacyWeekColumns(
          getVal('周数类型', 'WeekType'),
          getVal('起始周', 'StartWeek'),
          getVal('结束周', 'EndWeek'),
          getVal('自定义周', 'CustomWeeks'),
          totalWeeks
        );

    rows.push(validateAndBuildCourseRow({
      name: getVal('课程名称', 'CourseName'),
      teacher: getVal('教师', 'Teacher'),
      location: getVal('地点', 'Location'),
      dayOfWeek: getVal('星期', 'DayOfWeek'),
      startPeriod: getVal('开始节次', 'StartPeriod'),
      endPeriod: getVal('结束节次', 'EndPeriod'),
      weekParseResult
    }, totalWeeks, maxPeriod));
  });

  return { rows, errors };
}

export function exportCourseCsv(coursesWithSessions, totalWeeks) {
  const rows = [];
  for (const { course, sessions } of coursesWithSessions) {
    for (const sess of sessions) {
      rows.push([
        course.name,
        course.teacher || '',
        sess.location || '',
        sess.dayOfWeek,
        sess.startPeriod,
        sess.endPeriod,
        formatSessionWeeks(sess, totalWeeks, 'csv')
      ]);
    }
  }
  return buildCsv(COURSE_CSV_HEADERS, rows);
}

// ---------------- Schedule CSV Import & Export ----------------
export function parseScheduleCsv(rawCsv) {
  const periods = [];
  let scheduleName = '';

  const { errors } = parseCsvTable(rawCsv, (getVal) => {
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
  });

  periods.sort((a, b) => a.periodNumber - b.periodNumber);
  return { scheduleName, periods, errors };
}

export function exportScheduleCsv(scheduleName, periods) {
  const sortedPeriods = [...periods].sort((a, b) => a.periodNumber - b.periodNumber);
  const rows = sortedPeriods.map(p => [scheduleName, p.periodNumber, p.startTime, p.endTime]);
  return buildCsv(SCHEDULE_CSV_HEADERS, rows);
}
