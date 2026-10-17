/**
 * SleepIn Web Database Layer
 * Implements IndexedDB storage with localStorage fallback, matching Android Room entities.
 */

const DB_NAME = 'SleepInDB';
const DB_VERSION = 1;

let dbInstance = null;

export async function getDB() {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Settings
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Timetables
      if (!db.objectStoreNames.contains('timetables')) {
        const ttStore = db.createObjectStore('timetables', { keyPath: 'id', autoIncrement: true });
        ttStore.createIndex('isActive', 'isActive', { unique: false });
      }

      // Schedules
      if (!db.objectStoreNames.contains('schedules')) {
        db.createObjectStore('schedules', { keyPath: 'id', autoIncrement: true });
      }

      // Schedule Periods
      if (!db.objectStoreNames.contains('schedule_periods')) {
        const spStore = db.createObjectStore('schedule_periods', { keyPath: 'id', autoIncrement: true });
        spStore.createIndex('scheduleId', 'scheduleId', { unique: false });
      }

      // Courses
      if (!db.objectStoreNames.contains('courses')) {
        const cStore = db.createObjectStore('courses', { keyPath: 'id', autoIncrement: true });
        cStore.createIndex('timetableId', 'timetableId', { unique: false });
      }

      // Course Sessions
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

function tx(storeNames, mode = 'readonly') {
  return dbInstance.transaction(storeNames, mode);
}

// ----------------- Seeding -----------------
export async function seedInitialDataIfNeeded() {
  const db = await getDB();
  const schedules = await getAllSchedules();

  if (schedules.length === 0) {
    // 1. Seed Default Schedule (默认作息: 12节课)
    const scheduleId = await addSchedule({
      name: '默认作息',
      createdAt: Date.now()
    });

    const defaultPeriods = [
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

    for (const p of defaultPeriods) {
      await addSchedulePeriod({
        scheduleId,
        periodNumber: p.periodNumber,
        startTime: p.startTime,
        endTime: p.endTime
      });
    }

    // 2. Calculate semester start date (Monday of current semester)
    const today = new Date();
    const day = today.getDay(); // 0 is Sunday
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const mondayThisWeek = new Date(today);
    mondayThisWeek.setDate(today.getDate() + diffToMonday);
    // Let's set start date 4 weeks ago so we are nicely in week 5 of the semester!
    const semesterStart = new Date(mondayThisWeek);
    semesterStart.setDate(mondayThisWeek.getDate() - 28);
    const startDateStr = semesterStart.toISOString().split('T')[0];

    // 3. Seed Default Timetable
    const timetableId = await addTimetable({
      name: '2026年春季学期',
      totalWeeks: 18,
      startDate: startDateStr,
      scheduleId,
      colorScheme: 'default',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // 4. Seed Realistic Sample Courses
    // Colors matching DefaultCourseColors
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
    // 检查已有数据库是否需要将“默认作息”平滑升级为最新的 14 节课作息
    const defaultSchedule14V1Key = 'sleepin_schedule_14periods_v1';
    if (!localStorage.getItem(defaultSchedule14V1Key)) {
      try {
        const defaultSch = schedules.find(s => s.name === '默认作息') || schedules[0];
        if (defaultSch) {
          const standard14Periods = [
            { periodNumber: 1, startTime: '08:00', endTime: '08:45' },
            { periodNumber: 2, startTime: '08:55', endTime: '09:40' },
            { periodNumber: 3, startTime: '10:00', endTime: '10:45' },
            { periodNumber: 4, startTime: '10:55', endTime: '11:40' },
            { periodNumber: 5, startTime: '12:00', endTime: '12:45' },
            { periodNumber: 6, startTime: '12:55', endTime: '13:40' },
            { periodNumber: 7, startTime: '14:00', endTime: '14:45' },
            { periodNumber: 8, startTime: '14:55', endTime: '15:40' },
            { periodNumber: 9, startTime: '16:00', endTime: '16:45' },
            { periodNumber: 10, startTime: '16:55', endTime: '17:40' },
            { periodNumber: 11, startTime: '18:30', endTime: '19:15' },
            { periodNumber: 12, startTime: '19:25', endTime: '20:10' },
            { periodNumber: 13, startTime: '20:20', endTime: '21:05' },
            { periodNumber: 14, startTime: '21:15', endTime: '22:00' }
          ];
          await replaceSchedulePeriods(defaultSch.id, standard14Periods);
        }
      } catch (err) {
        console.warn('Auto upgrade default schedule failed:', err);
      }
      localStorage.setItem(defaultSchedule14V1Key, 'true');
    }
  }

  // 5. Initialize Settings
  const settings = await getSettings();
  if (!settings || Object.keys(settings).length === 0) {
    await updateSettings({
      notificationsEnabled: true,
      reminderMinutes: 10,
      fluidCloudEnabled: true,
      themeMode: 'SYSTEM',
      dynamicColorEnabled: true,
      courseCellHeightDp: 88,
      showNonCurrentWeekCourses: true,
      autoCheckUpdateEnabled: true
    });
  }
}

// ----------------- Settings Store -----------------
export async function getSettings() {
  const db = await getDB();
  return new Promise((resolve) => {
    const transaction = db.transaction('settings', 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.get('app_settings');
    request.onsuccess = () => {
      const defaultSettings = {
        notificationsEnabled: true,
        reminderMinutes: 10,
        fluidCloudEnabled: true,
        themeMode: 'SYSTEM',
        dynamicColorEnabled: true,
        courseCellHeightDp: 88,
        showNonCurrentWeekCourses: true,
        autoCheckUpdateEnabled: true
      };

      const val = request.result?.value;
      if (!val) {
        resolve(defaultSettings);
        return;
      }

      // 如果是旧版本的 68px 挤压高度，自动升级为舒适的 88px 可滚动高度
      if (!localStorage.getItem('sleepin_cell_height_upgraded_v2') && (!val.courseCellHeightDp || val.courseCellHeightDp <= 68)) {
        val.courseCellHeightDp = 88;
        localStorage.setItem('sleepin_cell_height_upgraded_v2', 'true');
        updateSettings({ courseCellHeightDp: 88 }).catch(console.error);
      }

      resolve({ ...defaultSettings, ...val });
    };
    request.onerror = () => resolve({});
  });
}

export async function updateSettings(newSettings) {
  const db = await getDB();
  const current = await getSettings();
  const merged = { ...current, ...newSettings };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    const store = transaction.objectStore('settings');
    const request = store.put({ key: 'app_settings', value: merged });
    request.onsuccess = () => {
      // Also sync to localStorage for redundancy
      try {
        localStorage.setItem('sleepin_app_settings', JSON.stringify(merged));
      } catch (e) {}
      resolve(merged);
    };
    request.onerror = () => reject(request.error);
  });
}

// ----------------- Timetables Store -----------------
export async function getAllTimetables() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('timetables', 'readonly');
    const store = transaction.objectStore('timetables');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getActiveTimetable() {
  const all = await getAllTimetables();
  return all.find(t => t.isActive) || all[0] || null;
}

export async function getTimetableById(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('timetables', 'readonly');
    const store = transaction.objectStore('timetables');
    const request = store.get(Number(id));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function addTimetable(timetable) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('timetables', 'readwrite');
    const store = transaction.objectStore('timetables');
    const request = store.add(timetable);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function updateTimetable(timetable) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('timetables', 'readwrite');
    const store = transaction.objectStore('timetables');
    const request = store.put(timetable);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function setActiveTimetable(timetableId) {
  const timetables = await getAllTimetables();
  const db = await getDB();
  const transaction = db.transaction('timetables', 'readwrite');
  const store = transaction.objectStore('timetables');

  for (const t of timetables) {
    t.isActive = (t.id === Number(timetableId));
    store.put(t);
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteTimetable(timetableId) {
  const db = await getDB();
  const tid = Number(timetableId);

  // Cascade delete courses and sessions
  const courses = await getCoursesByTimetable(tid);
  for (const c of courses) {
    await deleteCourse(c.id);
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('timetables', 'readwrite');
    const store = transaction.objectStore('timetables');
    const request = store.delete(tid);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ----------------- Schedules Store -----------------
export async function getAllSchedules() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('schedules', 'readonly');
    const store = transaction.objectStore('schedules');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getScheduleById(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('schedules', 'readonly');
    const store = transaction.objectStore('schedules');
    const request = store.get(Number(id));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function addSchedule(schedule) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('schedules', 'readwrite');
    const store = transaction.objectStore('schedules');
    const request = store.add(schedule);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function updateSchedule(schedule) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('schedules', 'readwrite');
    const store = transaction.objectStore('schedules');
    const request = store.put(schedule);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSchedule(scheduleId) {
  const sid = Number(scheduleId);
  const db = await getDB();

  // Delete all periods for this schedule
  const periods = await getPeriodsBySchedule(sid);
  const pTx = db.transaction('schedule_periods', 'readwrite');
  const pStore = pTx.objectStore('schedule_periods');
  for (const p of periods) {
    pStore.delete(p.id);
  }

  return new Promise((resolve, reject) => {
    pTx.oncomplete = () => {
      const sTx = db.transaction('schedules', 'readwrite');
      const sStore = sTx.objectStore('schedules');
      const req = sStore.delete(sid);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    };
    pTx.onerror = () => reject(pTx.error);
  });
}

// ----------------- Schedule Periods Store -----------------
export async function getPeriodsBySchedule(scheduleId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('schedule_periods', 'readonly');
    const store = transaction.objectStore('schedule_periods');
    const index = store.index('scheduleId');
    const request = index.getAll(Number(scheduleId));
    request.onsuccess = () => {
      const list = request.result || [];
      list.sort((a, b) => a.periodNumber - b.periodNumber);
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addSchedulePeriod(period) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('schedule_periods', 'readwrite');
    const store = transaction.objectStore('schedule_periods');
    const request = store.add(period);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function replaceSchedulePeriods(scheduleId, periods) {
  const db = await getDB();
  const existing = await getPeriodsBySchedule(scheduleId);
  const transaction = db.transaction('schedule_periods', 'readwrite');
  const store = transaction.objectStore('schedule_periods');

  for (const ex of existing) {
    store.delete(ex.id);
  }
  for (const p of periods) {
    store.add({
      scheduleId: Number(scheduleId),
      periodNumber: p.periodNumber,
      startTime: p.startTime,
      endTime: p.endTime
    });
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// ----------------- Courses & Sessions Store -----------------
export async function getCoursesByTimetable(timetableId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('courses', 'readonly');
    const store = transaction.objectStore('courses');
    const index = store.index('timetableId');
    const request = index.getAll(Number(timetableId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getSessionsByCourse(courseId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('course_sessions', 'readonly');
    const store = transaction.objectStore('course_sessions');
    const index = store.index('courseId');
    const request = index.getAll(Number(courseId));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getCoursesWithSessions(timetableId) {
  const courses = await getCoursesByTimetable(timetableId);
  const result = [];
  for (const c of courses) {
    const sessions = await getSessionsByCourse(c.id);
    result.push({ course: c, sessions });
  }
  return result;
}

export async function getCourseDetail(courseId) {
  const db = await getDB();
  const cid = Number(courseId);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['courses', 'course_sessions'], 'readonly');
    const cStore = transaction.objectStore('courses');
    const csStore = transaction.objectStore('course_sessions');
    const csIndex = csStore.index('courseId');

    const cReq = cStore.get(cid);
    cReq.onsuccess = () => {
      const course = cReq.result;
      if (!course) return resolve(null);

      const csReq = csIndex.getAll(cid);
      csReq.onsuccess = () => {
        resolve({ course, sessions: csReq.result || [] });
      };
    };
    cReq.onerror = () => reject(cReq.error);
  });
}

export async function saveCourseWithSessions(courseData, sessionsData) {
  const db = await getDB();
  const transaction = db.transaction(['courses', 'course_sessions'], 'readwrite');
  const cStore = transaction.objectStore('courses');
  const csStore = transaction.objectStore('course_sessions');

  let courseId = courseData.id ? Number(courseData.id) : null;

  return new Promise((resolve, reject) => {
    if (courseId) {
      // Update existing course
      cStore.put(courseData);
      // Delete old sessions
      const csIndex = csStore.index('courseId');
      const getOldReq = csIndex.getAll(courseId);
      getOldReq.onsuccess = () => {
        (getOldReq.result || []).forEach(s => csStore.delete(s.id));
        // Add new sessions
        sessionsData.forEach(s => {
          csStore.add({
            courseId,
            dayOfWeek: Number(s.dayOfWeek),
            startPeriod: Number(s.startPeriod),
            endPeriod: Number(s.endPeriod),
            location: s.location || '',
            weekType: s.weekType || 'ALL',
            startWeek: s.startWeek != null ? Number(s.startWeek) : null,
            endWeek: s.endWeek != null ? Number(s.endWeek) : null,
            customWeeks: Array.isArray(s.customWeeks) ? s.customWeeks : []
          });
        });
      };
    } else {
      // Add new course
      const addReq = cStore.add({
        timetableId: Number(courseData.timetableId),
        name: courseData.name.trim(),
        teacher: courseData.teacher ? courseData.teacher.trim() : '',
        color: courseData.color,
        note: courseData.note ? courseData.note.trim() : '',
        createdAt: Date.now()
      });

      addReq.onsuccess = () => {
        courseId = addReq.result;
        sessionsData.forEach(s => {
          csStore.add({
            courseId,
            dayOfWeek: Number(s.dayOfWeek),
            startPeriod: Number(s.startPeriod),
            endPeriod: Number(s.endPeriod),
            location: s.location || '',
            weekType: s.weekType || 'ALL',
            startWeek: s.startWeek != null ? Number(s.startWeek) : null,
            endWeek: s.endWeek != null ? Number(s.endWeek) : null,
            customWeeks: Array.isArray(s.customWeeks) ? s.customWeeks : []
          });
        });
      };
    }

    transaction.oncomplete = () => resolve(courseId);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteCourse(courseId) {
  const cid = Number(courseId);
  const db = await getDB();
  const transaction = db.transaction(['courses', 'course_sessions'], 'readwrite');
  const cStore = transaction.objectStore('courses');
  const csStore = transaction.objectStore('course_sessions');
  const csIndex = csStore.index('courseId');

  cStore.delete(cid);
  const req = csIndex.getAll(cid);
  req.onsuccess = () => {
    (req.result || []).forEach(s => csStore.delete(s.id));
  };

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// ----------------- Full Backup & Restore -----------------
export async function exportFullBackupJSON() {
  const settings = await getSettings();
  const timetables = await getAllTimetables();
  const schedules = await getAllSchedules();
  
  const schedulePeriods = [];
  for (const s of schedules) {
    const periods = await getPeriodsBySchedule(s.id);
    schedulePeriods.push(...periods);
  }

  const courses = [];
  const sessions = [];
  for (const t of timetables) {
    const tCourses = await getCoursesByTimetable(t.id);
    for (const c of tCourses) {
      courses.push(c);
      const cSessions = await getSessionsByCourse(c.id);
      sessions.push(...cSessions);
    }
  }

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
  const tx = db.transaction(
    ['settings', 'timetables', 'schedules', 'schedule_periods', 'courses', 'course_sessions'],
    'readwrite'
  );

  // Clear existing
  ['settings', 'timetables', 'schedules', 'schedule_periods', 'courses', 'course_sessions'].forEach(s => {
    tx.objectStore(s).clear();
  });

  if (data.settings) {
    tx.objectStore('settings').put({ key: 'app_settings', value: data.settings });
  }

  data.schedules.forEach(s => tx.objectStore('schedules').put(s));
  (data.schedulePeriods || []).forEach(p => tx.objectStore('schedule_periods').put(p));
  data.timetables.forEach(t => tx.objectStore('timetables').put(t));
  (data.courses || []).forEach(c => tx.objectStore('courses').put(c));
  (data.sessions || []).forEach(sess => tx.objectStore('course_sessions').put(sess));

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
