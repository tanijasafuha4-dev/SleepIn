/**
 * SleepIn Web Database Layer & Shared Domain Utilities
 * Implements IndexedDB storage with localStorage fallback, matching Android Room entities.
 */

import { DEFAULT_TOTAL_WEEKS, DEFAULT_CELL_HEIGHT } from './config.js';

const DB_NAME = 'SleepInDB';
const DB_VERSION = 1;
const SETTINGS_STORAGE_KEY = 'sleepin_app_settings';

const ALL_STORES = Object.freeze([
  'settings',
  'timetables',
  'schedules',
  'schedule_periods',
  'courses',
  'course_sessions'
]);

let dbInstance = null;

export async function getDB() {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('timetables')) {
        const ttStore = db.createObjectStore('timetables', { keyPath: 'id', autoIncrement: true });
        ttStore.createIndex('isActive', 'isActive', { unique: false });
      }

      if (!db.objectStoreNames.contains('schedules')) {
        db.createObjectStore('schedules', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('schedule_periods')) {
        const spStore = db.createObjectStore('schedule_periods', { keyPath: 'id', autoIncrement: true });
        spStore.createIndex('scheduleId', 'scheduleId', { unique: false });
      }

      if (!db.objectStoreNames.contains('courses')) {
        const cStore = db.createObjectStore('courses', { keyPath: 'id', autoIncrement: true });
        cStore.createIndex('timetableId', 'timetableId', { unique: false });
      }

      if (!db.objectStoreNames.contains('course_sessions')) {
        const csStore = db.createObjectStore('course_sessions', { keyPath: 'id', autoIncrement: true });
        csStore.createIndex('courseId', 'courseId', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };
  });
}

// ----------------- Shared Date, Time & Semester Utilities -----------------
export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts JS Date to ISO day of week: 1 = Monday ... 7 = Sunday.
 */
export function getIsoDayOfWeek(date = new Date()) {
  const jsDay = date.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function timeToMinutes(timeStr) {
  const [h, m] = String(timeStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(totalMinutes) {
  const safe = Math.max(0, Math.floor(totalMinutes));
  const h = String(Math.floor(safe / 60)).padStart(2, '0');
  const m = String(safe % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Unified semester week & status calculation used by both UI and Reminder service.
 */
export function computeSemesterStatus(timetable, refDate = new Date()) {
  if (!timetable || !timetable.startDate) {
    return { currentWeek: null, semesterStatus: null, totalWeeks: DEFAULT_TOTAL_WEEKS };
  }

  const totalWeeks = Number(timetable.totalWeeks) || DEFAULT_TOTAL_WEEKS;
  const today = new Date(refDate);
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(timetable.startDate + 'T00:00:00');
  startDate.setHours(0, 0, 0, 0);

  const totalDays = totalWeeks * 7;
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + totalDays - 1);

  if (today < startDate) {
    return { currentWeek: null, semesterStatus: '学期未开始', totalWeeks };
  }
  if (today > endDate) {
    return { currentWeek: null, semesterStatus: '学期已结束', totalWeeks };
  }

  const diffDays = Math.round((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const currentWeek = Math.floor(diffDays / 7) + 1;
  return { currentWeek, semesterStatus: null, totalWeeks };
}

// ----------------- IndexedDB Internal Helpers -----------------
async function runStoreRequest(storeName, mode, op, transform) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = op(store);
    request.onsuccess = () => {
      const res = request.result;
      resolve(transform ? transform(res) : res);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error(`${storeName} transaction aborted`));
  });
}

function txDone(transaction, label, getResult = () => undefined) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(getResult());
    transaction.onerror = () => reject(transaction.error || new Error(`${label} failed`));
    transaction.onabort = () => reject(transaction.error || new Error(`${label} aborted`));
  });
}

function deleteByIndex(store, indexName, key, onEachKey = null) {
  const index = store.index(indexName);
  const req = index.getAllKeys(key);
  req.onsuccess = () => {
    for (const primaryKey of (req.result || [])) {
      store.delete(primaryKey);
      if (onEachKey) onEachKey(primaryKey);
    }
  };
}

// ----------------- Standard 14 Periods Definition -----------------
export const STANDARD_14_PERIODS = [
  // 上午
  { periodNumber: 1, startTime: '08:00', endTime: '08:45' },
  { periodNumber: 2, startTime: '08:55', endTime: '09:40' },
  { periodNumber: 3, startTime: '10:00', endTime: '10:45' },
  { periodNumber: 4, startTime: '10:55', endTime: '11:40' },
  // 中午
  { periodNumber: 5, startTime: '12:00', endTime: '12:45' },
  { periodNumber: 6, startTime: '12:55', endTime: '13:40' },
  // 下午
  { periodNumber: 7, startTime: '14:00', endTime: '14:45' },
  { periodNumber: 8, startTime: '14:55', endTime: '15:40' },
  { periodNumber: 9, startTime: '16:00', endTime: '16:45' },
  { periodNumber: 10, startTime: '16:55', endTime: '17:40' },
  // 晚上
  { periodNumber: 11, startTime: '18:30', endTime: '19:15' },
  { periodNumber: 12, startTime: '19:25', endTime: '20:10' },
  { periodNumber: 13, startTime: '20:20', endTime: '21:05' },
  { periodNumber: 14, startTime: '21:15', endTime: '22:00' }
];

export const DEFAULT_MAX_PERIOD = STANDARD_14_PERIODS.length;

export const DEFAULT_SETTINGS = Object.freeze({
  notificationsEnabled: true,
  reminderMinutes: 10,
  fluidCloudEnabled: true,
  themeMode: 'SYSTEM',
  dynamicColorEnabled: true,
  courseCellHeightDp: DEFAULT_CELL_HEIGHT,
  showNonCurrentWeekCourses: true,
  autoCheckUpdateEnabled: true
});

// ----------------- Seeding -----------------
export async function seedInitialDataIfNeeded() {
  await getDB();
  const schedules = await getAllSchedules();

  if (schedules.length === 0) {
    // 1. Seed Default Schedule (默认作息: 14节课)
    const scheduleId = await addSchedule({
      name: '默认作息',
      createdAt: Date.now()
    });

    await replaceSchedulePeriods(scheduleId, STANDARD_14_PERIODS);
    try {
      localStorage.setItem('sleepin_default_14_periods_upgraded_v1', 'true');
    } catch (e) {}

    // 2. Calculate semester start date (Monday of current semester in local timezone)
    const today = new Date();
    const diffToMonday = 1 - getIsoDayOfWeek(today);
    const mondayThisWeek = new Date(today);
    mondayThisWeek.setDate(today.getDate() + diffToMonday);
    // Set start date 4 weeks ago so we are in week 5 of the semester
    const semesterStart = new Date(mondayThisWeek);
    semesterStart.setDate(mondayThisWeek.getDate() - 28);
    const startDateStr = formatLocalDate(semesterStart);

    // 3. Seed Default Timetable
    const now = Date.now();
    const timetableId = await addTimetable({
      name: '2026年春季学期',
      totalWeeks: DEFAULT_TOTAL_WEEKS,
      startDate: startDateStr,
      scheduleId,
      colorScheme: 'default',
      isActive: true,
      createdAt: now,
      updatedAt: now
    });

    // 4. Seed Realistic Sample Courses
    const sampleCourses = [
      {
        name: '高等数学 (II)',
        teacher: '李教授',
        color: 0xFF4A90D9, // Blue
        note: '携带微积分教材与习题集',
        sessions: [
          { dayOfWeek: 1, startPeriod: 1, endPeriod: 2, location: '理教 201', weekType: 'ALL' },
          { dayOfWeek: 3, startPeriod: 3, endPeriod: 4, location: '理教 201', weekType: 'ALL' }
        ]
      },
      {
        name: '算法设计与分析',
        teacher: '王老师',
        color: 0xFF67C23A, // Green
        note: '机房上机需带实验报告',
        sessions: [
          { dayOfWeek: 2, startPeriod: 3, endPeriod: 4, location: '计机楼 B302', weekType: 'RANGE', startWeek: 1, endWeek: 16 },
          { dayOfWeek: 4, startPeriod: 5, endPeriod: 6, location: '信电楼 405', weekType: 'RANGE', startWeek: 1, endWeek: 16 }
        ]
      },
      {
        name: '操作系统原理',
        teacher: '陈教授',
        color: 0xFFE6A23C, // Orange
        note: '期中考试安排在第 10 周',
        sessions: [
          { dayOfWeek: 1, startPeriod: 5, endPeriod: 6, location: '工教 103', weekType: 'ALL' },
          { dayOfWeek: 5, startPeriod: 1, endPeriod: 2, location: '工教 103', weekType: 'ALL' }
        ]
      },
      {
        name: '大学英语 (四级)',
        teacher: 'Sarah Smith',
        color: 0xFF9B59B6, // Purple
        note: '线上视听说打卡已开放',
        sessions: [
          { dayOfWeek: 2, startPeriod: 1, endPeriod: 2, location: '外语楼 305', weekType: 'ALL' },
          { dayOfWeek: 4, startPeriod: 3, endPeriod: 4, location: '外语楼 305', weekType: 'ALL' }
        ]
      },
      {
        name: '计算机网络体系',
        teacher: '张老师',
        color: 0xFF1ABC9C, // Teal
        note: 'Wireshark 抓包实验',
        sessions: [
          { dayOfWeek: 3, startPeriod: 7, endPeriod: 8, location: '网络中心 202', weekType: 'CUSTOM', customWeeks: [1, 3, 5, 7, 9, 11, 13, 15] }
        ]
      },
      {
        name: '体育 (羽毛球)',
        teacher: '赵教练',
        color: 0xFFF56C6C, // Coral Red
        note: '自备球拍与室内运动鞋',
        sessions: [
          { dayOfWeek: 5, startPeriod: 7, endPeriod: 8, location: '气膜体育馆', weekType: 'ALL' }
        ]
      }
    ];

    for (const sc of sampleCourses) {
      await saveCourseWithSessions({
        timetableId,
        name: sc.name,
        teacher: sc.teacher,
        color: sc.color,
        note: sc.note
      }, sc.sessions);
    }
  } else {
    // 一次性平滑升级旧版 12 节默认作息至 14 节（标记后不再覆盖用户主动修改的节数）
    try {
      const alreadyUpgraded = localStorage.getItem('sleepin_default_14_periods_upgraded_v1');
      if (!alreadyUpgraded) {
        localStorage.setItem('sleepin_default_14_periods_upgraded_v1', 'true');
        const defaultSch = schedules.find(s => s.name === '默认作息') || schedules[0];
        if (defaultSch) {
          const existingPeriods = await getPeriodsBySchedule(defaultSch.id);
          if (existingPeriods.length === 0 || existingPeriods.length === 12) {
            await replaceSchedulePeriods(defaultSch.id, STANDARD_14_PERIODS);
          }
        }
      }
    } catch (err) {
      console.warn('Auto ensure 14 periods failed:', err);
    }
  }

  // 5. One-time Settings Migration (only write to DB when actually migrating)
  try {
    if (!localStorage.getItem('sleepin_cell_height_upgraded_v2')) {
      localStorage.setItem('sleepin_cell_height_upgraded_v2', 'true');
      const settings = await getSettings();
      if (!settings.courseCellHeightDp || settings.courseCellHeightDp <= 68) {
        await updateSettings({ courseCellHeightDp: DEFAULT_CELL_HEIGHT });
      }
    }
  } catch (e) {}
}

// ----------------- Settings Store -----------------
function saveSettingsMirror(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {}
}

function readSettingsFallbackFromLocalStorage() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {}
  return { ...DEFAULT_SETTINGS };
}

export async function getSettings() {
  try {
    const record = await runStoreRequest('settings', 'readonly', s => s.get('app_settings'));
    if (!record || !record.value) {
      return readSettingsFallbackFromLocalStorage();
    }
    return { ...DEFAULT_SETTINGS, ...record.value };
  } catch (e) {
    return readSettingsFallbackFromLocalStorage();
  }
}

export async function updateSettings(newSettings) {
  const current = await getSettings();
  const merged = { ...current, ...newSettings };
  saveSettingsMirror(merged);

  const db = await getDB();
  const transaction = db.transaction('settings', 'readwrite');
  transaction.objectStore('settings').put({ key: 'app_settings', value: merged });
  return txDone(transaction, 'updateSettings', () => merged);
}

// ----------------- Timetables Store -----------------
export function getAllTimetables() {
  return runStoreRequest('timetables', 'readonly', s => s.getAll(), res => res || []);
}

export async function getActiveTimetable() {
  const all = await getAllTimetables();
  return all.find(t => t.isActive) || all[0] || null;
}

export function getTimetableById(id) {
  return runStoreRequest('timetables', 'readonly', s => s.get(Number(id)), res => res || null);
}

export function addTimetable(timetable) {
  return runStoreRequest('timetables', 'readwrite', s => s.add(timetable));
}

export function updateTimetable(timetable) {
  return runStoreRequest('timetables', 'readwrite', s => s.put(timetable));
}

export async function setActiveTimetable(timetableId) {
  const db = await getDB();
  const targetId = Number(timetableId);
  const transaction = db.transaction('timetables', 'readwrite');
  const store = transaction.objectStore('timetables');
  const getAllReq = store.getAll();

  getAllReq.onsuccess = () => {
    for (const t of (getAllReq.result || [])) {
      const shouldBeActive = (t.id === targetId);
      if (t.isActive !== shouldBeActive) {
        t.isActive = shouldBeActive;
        store.put(t);
      }
    }
  };

  return txDone(transaction, 'setActiveTimetable');
}

export async function deleteTimetable(timetableId) {
  const db = await getDB();
  const tid = Number(timetableId);
  const transaction = db.transaction(['timetables', 'courses', 'course_sessions'], 'readwrite');
  const ttStore = transaction.objectStore('timetables');
  const cStore = transaction.objectStore('courses');
  const csStore = transaction.objectStore('course_sessions');

  ttStore.delete(tid);
  deleteByIndex(cStore, 'timetableId', tid, (courseId) => {
    deleteByIndex(csStore, 'courseId', courseId);
  });

  return txDone(transaction, 'deleteTimetable');
}

// ----------------- Schedules Store -----------------
export function getAllSchedules() {
  return runStoreRequest('schedules', 'readonly', s => s.getAll(), res => res || []);
}

export function getScheduleById(id) {
  return runStoreRequest('schedules', 'readonly', s => s.get(Number(id)), res => res || null);
}

export function addSchedule(schedule) {
  return runStoreRequest('schedules', 'readwrite', s => s.add(schedule));
}

export function updateSchedule(schedule) {
  return runStoreRequest('schedules', 'readwrite', s => s.put(schedule));
}

export async function deleteSchedule(scheduleId) {
  const sid = Number(scheduleId);
  const db = await getDB();
  const transaction = db.transaction(['schedules', 'schedule_periods'], 'readwrite');

  transaction.objectStore('schedules').delete(sid);
  deleteByIndex(transaction.objectStore('schedule_periods'), 'scheduleId', sid);

  return txDone(transaction, 'deleteSchedule');
}

// ----------------- Schedule Periods Store -----------------
export function getPeriodsBySchedule(scheduleId) {
  return runStoreRequest(
    'schedule_periods',
    'readonly',
    s => s.index('scheduleId').getAll(Number(scheduleId)),
    (res) => (res || []).sort((a, b) => a.periodNumber - b.periodNumber)
  );
}

export async function replaceSchedulePeriods(scheduleId, periods) {
  const db = await getDB();
  const sid = Number(scheduleId);
  const transaction = db.transaction('schedule_periods', 'readwrite');
  const store = transaction.objectStore('schedule_periods');

  deleteByIndex(store, 'scheduleId', sid);
  for (const p of periods) {
    store.add({
      scheduleId: sid,
      periodNumber: p.periodNumber,
      startTime: p.startTime,
      endTime: p.endTime
    });
  }

  return txDone(transaction, 'replaceSchedulePeriods');
}

// ----------------- Courses & Sessions Store -----------------
export async function getCoursesWithSessions(timetableId) {
  const db = await getDB();
  const tid = Number(timetableId);
  const transaction = db.transaction(['courses', 'course_sessions'], 'readonly');
  const cStore = transaction.objectStore('courses');
  const csStore = transaction.objectStore('course_sessions');
  const cIndex = cStore.index('timetableId');
  const csIndex = csStore.index('courseId');

  let result = [];
  const coursesReq = cIndex.getAll(tid);
  coursesReq.onsuccess = () => {
    const courses = coursesReq.result || [];
    result = new Array(courses.length);
    courses.forEach((course, idx) => {
      const sReq = csIndex.getAll(course.id);
      sReq.onsuccess = () => {
        result[idx] = { course, sessions: sReq.result || [] };
      };
    });
  };

  return txDone(transaction, 'getCoursesWithSessions', () => result);
}

export async function getCourseDetail(courseId) {
  const db = await getDB();
  const cid = Number(courseId);
  const transaction = db.transaction(['courses', 'course_sessions'], 'readonly');
  const cStore = transaction.objectStore('courses');
  const csIndex = transaction.objectStore('course_sessions').index('courseId');

  let detail = null;
  const cReq = cStore.get(cid);
  cReq.onsuccess = () => {
    const course = cReq.result;
    if (!course) return;
    const csReq = csIndex.getAll(cid);
    csReq.onsuccess = () => {
      detail = { course, sessions: csReq.result || [] };
    };
  };

  return txDone(transaction, 'getCourseDetail', () => detail);
}

function buildCourseEntity(courseData, prev = null) {
  const now = Date.now();
  const base = {
    timetableId: Number(courseData.timetableId),
    name: (courseData.name || '').trim(),
    teacher: courseData.teacher ? courseData.teacher.trim() : '',
    color: courseData.color,
    note: courseData.note ? courseData.note.trim() : '',
    createdAt: (prev && prev.createdAt) || courseData.createdAt || now,
    updatedAt: now
  };
  if (prev && prev.id != null) {
    return { ...prev, ...base, id: Number(prev.id) };
  }
  return base;
}

function buildSessionEntity(courseId, s) {
  return {
    courseId,
    dayOfWeek: Number(s.dayOfWeek),
    startPeriod: Number(s.startPeriod),
    endPeriod: Number(s.endPeriod),
    location: (s.location || '').trim(),
    weekType: s.weekType || 'ALL',
    startWeek: s.startWeek != null ? Number(s.startWeek) : null,
    endWeek: s.endWeek != null ? Number(s.endWeek) : null,
    customWeeks: Array.isArray(s.customWeeks) ? [...s.customWeeks] : []
  };
}

export async function saveCourseWithSessions(courseData, sessionsData) {
  const db = await getDB();
  const transaction = db.transaction(['courses', 'course_sessions'], 'readwrite');
  const cStore = transaction.objectStore('courses');
  const csStore = transaction.objectStore('course_sessions');

  let courseId = courseData.id ? Number(courseData.id) : null;

  if (courseId) {
    const existingReq = cStore.get(courseId);
    existingReq.onsuccess = () => {
      const prev = { ...(existingReq.result || {}), id: courseId };
      cStore.put(buildCourseEntity(courseData, prev));
      deleteByIndex(csStore, 'courseId', courseId);
      sessionsData.forEach(s => csStore.add(buildSessionEntity(courseId, s)));
    };
  } else {
    const addReq = cStore.add(buildCourseEntity(courseData));
    addReq.onsuccess = () => {
      courseId = addReq.result;
      sessionsData.forEach(s => csStore.add(buildSessionEntity(courseId, s)));
    };
  }

  return txDone(transaction, 'saveCourseWithSessions', () => courseId);
}

export async function deleteCourse(courseId) {
  const cid = Number(courseId);
  const db = await getDB();
  const transaction = db.transaction(['courses', 'course_sessions'], 'readwrite');

  transaction.objectStore('courses').delete(cid);
  deleteByIndex(transaction.objectStore('course_sessions'), 'courseId', cid);

  return txDone(transaction, 'deleteCourse');
}

// ----------------- Full Backup & Restore -----------------
export async function exportFullBackupJSON() {
  const settings = await getSettings();
  const db = await getDB();

  const transaction = db.transaction(
    ['timetables', 'schedules', 'schedule_periods', 'courses', 'course_sessions'],
    'readonly'
  );
  const data = {};

  const stores = [
    ['timetables', 'timetables'],
    ['schedules', 'schedules'],
    ['schedulePeriods', 'schedule_periods'],
    ['courses', 'courses'],
    ['sessions', 'course_sessions']
  ];

  for (const [key, storeName] of stores) {
    const req = transaction.objectStore(storeName).getAll();
    req.onsuccess = () => {
      data[key] = req.result || [];
    };
  }

  const { timetables, schedules, schedulePeriods, courses, sessions } = await txDone(
    transaction,
    'exportFullBackupJSON',
    () => data
  );

  schedulePeriods.sort((a, b) => (a.scheduleId - b.scheduleId) || (a.periodNumber - b.periodNumber));

  const backup = {
    version: 2,
    appName: 'SleepIn',
    exportedAt: new Date().toISOString(),
    settings,
    timetables,
    schedules,
    schedulePeriods,
    courses,
    sessions
  };

  return JSON.stringify(backup, null, 2);
}

export async function importFullBackupJSON(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data || !data.timetables || !data.schedules) {
    throw new Error('无效的备份文件：缺少课表或作息表数据');
  }

  const db = await getDB();
  const tx = db.transaction(ALL_STORES, 'readwrite');

  ALL_STORES.forEach(s => tx.objectStore(s).clear());

  if (data.settings) {
    const mergedSettings = { ...DEFAULT_SETTINGS, ...data.settings };
    tx.objectStore('settings').put({ key: 'app_settings', value: mergedSettings });
    saveSettingsMirror(mergedSettings);
  }

  data.schedules.forEach(s => tx.objectStore('schedules').put(s));
  (data.schedulePeriods || []).forEach(p => tx.objectStore('schedule_periods').put(p));
  data.timetables.forEach(t => tx.objectStore('timetables').put(t));
  (data.courses || []).forEach(c => tx.objectStore('courses').put(c));
  (data.sessions || []).forEach(sess => tx.objectStore('course_sessions').put(sess));

  return txDone(tx, 'importFullBackupJSON');
}
