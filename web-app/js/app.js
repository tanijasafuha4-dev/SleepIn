/**
 * SleepIn Web - Main Application Logic
 * Implements MVVM state coordination, navigation, week grid layout,
 * touch gestures, sheets/modals, and PWA setup.
 */

import {
  seedInitialDataIfNeeded,
  getSettings,
  updateSettings,
  getAllTimetables,
  getActiveTimetable,
  getTimetableById,
  addTimetable,
  updateTimetable,
  setActiveTimetable,
  deleteTimetable,
  getAllSchedules,
  getScheduleById,
  addSchedule,
  updateSchedule,
  deleteSchedule,
  getPeriodsBySchedule,
  replaceSchedulePeriods,
  getCoursesWithSessions,
  getCourseDetail,
  saveCourseWithSessions,
  deleteCourse,
  exportFullBackupJSON,
  importFullBackupJSON
} from './db.js';

import {
  parseCourseCsv,
  exportCourseCsv,
  parseScheduleCsv,
  exportScheduleCsv
} from './csv.js';

import {
  checkCourseConflicts,
  resolveWeeks
} from './conflict.js';

import {
  playReminderChime,
  requestNotificationPermission,
  startReminderScheduler,
  showFluidCloudToast
} from './reminder.js';

import {
  DEFAULT_COURSE_COLORS,
  intToHexColor,
  hexToIntColor,
  getContrastTextColor,
  applyTheme,
  listenSystemThemeChange
} from './theme.js';

// ---------------- App State ----------------
const state = {
  activeTimetable: null,
  allTimetables: [],
  allSchedules: [],
  periods: [],
  courses: [], // CourseWithSessions
  selectedWeek: 1,
  currentWeek: null,
  totalWeeks: 18,
  semesterStatus: null, // null | '学期未开始' | '学期已结束'
  settings: {},
  weekDates: [],
  selectedCourseDetail: null,
  editingTimetableId: null,
  editingScheduleId: null,
  managingCourseTimetableId: null,
  editingCourseId: null,
  pendingForceSaveCourse: null
};

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_LABELS_FULL = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

// ---------------- Initialization ----------------
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Seed initial data if DB empty
  await seedInitialDataIfNeeded();

  // 2. Load settings and apply theme
  state.settings = await getSettings();
  applyTheme(state.settings.themeMode);
  listenSystemThemeChange(() => {
    if (state.settings.themeMode === 'SYSTEM') {
      applyTheme('SYSTEM');
    }
  });

  // 3. Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  }

  // 4. Check for iOS Safari Add-To-Home-Screen banner
  checkIosPwaBanner();

  // 5. Start reminder engine
  startReminderScheduler();

  // 6. Bind UI event listeners
  bindEvents();

  // 7. Initial refresh of active timetable and views
  await refreshAll();

  // 8. Start real-time clock ticker
  setInterval(updateCurrentTimeIndicator, 30000);
});

// ---------------- Main Data Refresh ----------------
async function refreshAll() {
  state.settings = await getSettings();
  state.allTimetables = await getAllTimetables();
  state.allSchedules = await getAllSchedules();
  state.activeTimetable = await getActiveTimetable();

  if (!state.activeTimetable && state.allTimetables.length > 0) {
    state.activeTimetable = state.allTimetables[0];
    await setActiveTimetable(state.activeTimetable.id);
  }

  if (state.activeTimetable) {
    state.totalWeeks = state.activeTimetable.totalWeeks || 18;
    calculateSemesterWeek();
    state.periods = await getPeriodsBySchedule(state.activeTimetable.scheduleId);
    state.courses = await getCoursesWithSessions(state.activeTimetable.id);
  } else {
    state.periods = [];
    state.courses = [];
  }

  renderTopBar();
  renderWeekGrid();
}

// ---------------- Date & Semester Week Calculations ----------------
function calculateSemesterWeek() {
  if (!state.activeTimetable) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(state.activeTimetable.startDate + 'T00:00:00');
  startDate.setHours(0, 0, 0, 0);

  const totalDays = state.totalWeeks * 7;
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + totalDays - 1);

  if (today < startDate) {
    state.semesterStatus = '学期未开始';
    state.currentWeek = null;
  } else if (today > endDate) {
    state.semesterStatus = '学期已结束';
    state.currentWeek = null;
  } else {
    state.semesterStatus = null;
    const diffTime = today.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    state.currentWeek = Math.floor(diffDays / 7) + 1;
  }

  // Set selected week if not initialized or out of range
  if (!state.selectedWeek || state.selectedWeek > state.totalWeeks || state.selectedWeek < 1) {
    state.selectedWeek = state.currentWeek || 1;
  }
}

function getWeekDates(startDateStr, weekNum) {
  const startDate = new Date(startDateStr + 'T00:00:00');
  const safeWeek = Math.max(1, weekNum);
  const firstDay = new Date(startDate);
  firstDay.setDate(startDate.getDate() + (safeWeek - 1) * 7);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(firstDay);
    d.setDate(firstDay.getDate() + i);
    dates.push(d);
  }
  return dates;
}

// ---------------- Top Bar Rendering ----------------
function renderTopBar() {
  const topDateEl = document.getElementById('top-bar-date');
  const topWeekEl = document.getElementById('top-bar-week-info');
  const bannerEl = document.getElementById('semester-status-banner');

  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const date = now.getDate().toString().padStart(2, '0');
  const dayName = DAY_LABELS_FULL[(now.getDay() + 6) % 7];

  topDateEl.textContent = `${year}年${month}月${date}日 ${dayName}`;

  if (!state.activeTimetable) {
    topWeekEl.textContent = '未选择课程表';
    bannerEl.style.display = 'none';
    return;
  }

  let weekStr = `第 ${state.selectedWeek} 周`;
  if (state.currentWeek && state.currentWeek !== state.selectedWeek) {
    weekStr += ` · 当前为第 ${state.currentWeek} 周`;
  }
  topWeekEl.textContent = weekStr;

  if (state.semesterStatus) {
    bannerEl.textContent = `📢 ${state.semesterStatus}`;
    bannerEl.style.display = 'flex';
  } else {
    bannerEl.style.display = 'none';
  }
}

// ---------------- Week Grid Rendering ----------------
function renderWeekGrid() {
  const emptyView = document.getElementById('empty-state-view');
  const gridWrapper = document.getElementById('week-view-wrapper');

  if (!state.activeTimetable) {
    emptyView.style.display = 'flex';
    gridWrapper.style.display = 'none';
    return;
  }

  emptyView.style.display = 'none';
  gridWrapper.style.display = 'flex';

  // Apply row height setting
  const rowHeight = (state.settings.courseCellHeightDp || 68);
  document.documentElement.style.setProperty('--cell-height', `${rowHeight}px`);

  // Render Header Dates
  const headerContainer = document.getElementById('days-header-container');
  headerContainer.innerHTML = '';

  const dates = getWeekDates(state.activeTimetable.startDate, state.selectedWeek);
  state.weekDates = dates;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let todayColumnIndex = null;
  if (state.currentWeek === state.selectedWeek) {
    todayColumnIndex = (today.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
  }

  dates.forEach((d, idx) => {
    const isToday = (todayColumnIndex === idx);
    const cell = document.createElement('div');
    cell.className = `day-header-cell ${isToday ? 'today' : ''}`;
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const dayDate = d.getDate().toString().padStart(2, '0');
    cell.innerHTML = `
      <span class="day-name">${DAY_NAMES[idx]}</span>
      <span class="day-date">${m}/${dayDate}</span>
    `;
    headerContainer.appendChild(cell);
  });

  // Render Sidebar Periods
  const sidebar = document.getElementById('timeline-sidebar');
  sidebar.innerHTML = '';
  state.periods.forEach((p) => {
    const cell = document.createElement('div');
    cell.className = 'period-sidebar-cell';
    cell.innerHTML = `
      <span class="period-num">${p.periodNumber}</span>
      <span class="period-time">${p.startTime}<br>${p.endTime}</span>
    `;
    sidebar.appendChild(cell);
  });

  // Grid Height
  const totalGridHeight = state.periods.length * rowHeight;
  const gridContent = document.getElementById('grid-content');
  gridContent.style.height = `${totalGridHeight}px`;

  // Render Column Overlay with Today Highlight
  const colsOverlay = document.getElementById('grid-cols-overlay');
  colsOverlay.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const col = document.createElement('div');
    col.className = `grid-column-line ${todayColumnIndex === i ? 'today-col' : ''}`;
    colsOverlay.appendChild(col);
  }

  // Render Course Cards
  renderCourseCards(rowHeight);

  // Update Red Current Time Line
  updateCurrentTimeIndicator();
}

function renderCourseCards(rowHeight) {
  const container = document.getElementById('course-cells-layer');
  container.innerHTML = '';

  const showNonCurrent = state.settings.showNonCurrentWeekCourses ?? true;

  // Flatten sessions with recurrence status
  const visibleItems = [];

  state.courses.forEach((item) => {
    const { course, sessions } = item;
    sessions.forEach((sess) => {
      const activeWeeks = resolveWeeks(
        sess.weekType,
        sess.startWeek,
        sess.endWeek,
        sess.customWeeks,
        state.totalWeeks
      );
      const isCurrentWeek = activeWeeks.has(state.selectedWeek);

      if (isCurrentWeek || showNonCurrent) {
        visibleItems.push({
          course,
          session: sess,
          isCurrentWeek
        });
      }
    });
  });

  visibleItems.forEach((item) => {
    const { course, session, isCurrentWeek } = item;
    const dayIdx = session.dayOfWeek - 1; // 0..6
    if (dayIdx < 0 || dayIdx > 6) return;

    const startRow = session.startPeriod - 1;
    const span = (session.endPeriod - session.startPeriod + 1);

    const topPx = startRow * rowHeight + 2;
    const heightPx = span * rowHeight - 4;
    const leftPercent = dayIdx * (100 / 7);
    const widthPercent = (100 / 7);

    const hexColor = intToHexColor(course.color);
    const textColor = '#FFFFFF';

    const card = document.createElement('div');
    card.className = `course-cell-card ${!isCurrentWeek ? 'non-current' : ''}`;
    card.style.top = `${topPx}px`;
    card.style.height = `${heightPx}px`;
    card.style.left = `calc(${leftPercent}% + 2px)`;
    card.style.width = `calc(${widthPercent}% - 4px)`;
    card.style.backgroundColor = hexColor;
    card.style.color = textColor;

    const nonCurrentBadge = !isCurrentWeek ? `<div class="cell-non-current-badge">非本周</div>` : '';
    const locStr = session.location ? `<div class="cell-location">@${session.location}</div>` : '';
    const teacherStr = course.teacher ? `<div class="cell-teacher">${course.teacher}</div>` : '';

    card.innerHTML = `
      ${nonCurrentBadge}
      <div class="cell-title">${course.name}</div>
      ${locStr}
      ${teacherStr}
    `;

    card.addEventListener('click', () => {
      openCourseDetailSheet(course, session, isCurrentWeek);
    });

    container.appendChild(card);
  });
}

// ---------------- Current Time Indicator ----------------
function updateCurrentTimeIndicator() {
  const lineEl = document.getElementById('current-time-line');
  if (!lineEl || !state.activeTimetable || state.periods.length === 0) return;

  if (state.currentWeek !== state.selectedWeek) {
    lineEl.style.display = 'none';
    return;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const sortedPeriods = [...state.periods].sort((a, b) => a.periodNumber - b.periodNumber);
  const firstPeriod = sortedPeriods[0];
  const lastPeriod = sortedPeriods[sortedPeriods.length - 1];

  const [fH, fM] = firstPeriod.startTime.split(':').map(Number);
  const [lH, lM] = lastPeriod.endTime.split(':').map(Number);
  const startMins = fH * 60 + fM;
  const endMins = lH * 60 + lM;

  if (currentMinutes < startMins || currentMinutes > endMins) {
    lineEl.style.display = 'none';
    return;
  }

  const rowHeight = (state.settings.courseCellHeightDp || 68);
  let offsetRows = null;

  for (let i = 0; i < sortedPeriods.length; i++) {
    const p = sortedPeriods[i];
    const [sH, sM] = p.startTime.split(':').map(Number);
    const [eH, eM] = p.endTime.split(':').map(Number);
    const pStart = sH * 60 + sM;
    const pEnd = eH * 60 + eM;

    if (currentMinutes >= pStart && currentMinutes < pEnd) {
      const duration = pEnd - pStart;
      const elapsed = currentMinutes - pStart;
      offsetRows = i + (elapsed / duration);
      break;
    }

    const nextP = sortedPeriods[i + 1];
    if (nextP) {
      const [nsH, nsM] = nextP.startTime.split(':').map(Number);
      const nextStart = nsH * 60 + nsM;
      if (currentMinutes >= pEnd && currentMinutes < nextStart) {
        offsetRows = i + 1;
        break;
      }
    }
  }

  if (offsetRows != null) {
    const topPx = offsetRows * rowHeight;
    lineEl.style.top = `${topPx}px`;
    lineEl.style.display = 'block';
  } else {
    lineEl.style.display = 'none';
  }
}

// ---------------- UI Event Handlers ----------------
function bindEvents() {
  // Week navigation arrows
  document.getElementById('btn-prev-week').addEventListener('click', () => {
    if (state.selectedWeek > 1) {
      state.selectedWeek--;
      renderTopBar();
      renderWeekGrid();
    }
  });

  document.getElementById('btn-next-week').addEventListener('click', () => {
    if (state.selectedWeek < state.totalWeeks) {
      state.selectedWeek++;
      renderTopBar();
      renderWeekGrid();
    }
  });

  // Home Menu Sheet button
  document.getElementById('btn-open-menu').addEventListener('click', openHomeMenuSheet);
  document.getElementById('btn-add-course').addEventListener('click', () => {
    if (!state.activeTimetable) {
      alert('请先选择或创建一个课程表');
      return;
    }
    openCourseEditorModal(null, state.activeTimetable.id);
  });

  // Touch Swipe for Week Navigation
  initTouchSwipe();

  // Bottom Sheet backdrop click
  document.getElementById('home-menu-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'home-menu-backdrop') closeHomeMenuSheet();
  });
  document.getElementById('course-detail-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'course-detail-backdrop') closeCourseDetailSheet();
  });

  // Home Menu Sheet Actions
  document.getElementById('menu-tile-timetable').addEventListener('click', () => {
    closeHomeMenuSheet();
    openTimetableListModal();
  });
  document.getElementById('menu-tile-schedule').addEventListener('click', () => {
    closeHomeMenuSheet();
    openScheduleListModal();
  });
  document.getElementById('menu-tile-settings').addEventListener('click', () => {
    closeHomeMenuSheet();
    openSettingsModal();
  });

  // Menu week slider
  const weekSlider = document.getElementById('menu-week-slider');
  weekSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.selectedWeek = val;
    document.getElementById('menu-week-slider-label').textContent = `第 ${val} 周 / 共 ${state.totalWeeks} 周`;
    renderTopBar();
    renderWeekGrid();
  });

  // Empty state buttons
  document.getElementById('btn-empty-create-timetable').addEventListener('click', () => {
    openTimetableEditorModal();
  });

  // Timetable List Modal buttons
  document.getElementById('btn-close-timetable-list').addEventListener('click', closeTimetableListModal);
  document.getElementById('btn-add-timetable-new').addEventListener('click', () => {
    openTimetableEditorModal();
  });

  // Timetable Editor Modal buttons
  document.getElementById('btn-close-timetable-editor').addEventListener('click', closeTimetableEditorModal);
  document.getElementById('btn-save-timetable').addEventListener('click', saveTimetableForm);
  document.getElementById('btn-import-timetable-csv').addEventListener('click', () => {
    document.getElementById('input-file-timetable-csv').click();
  });
  document.getElementById('input-file-timetable-csv').addEventListener('change', handleTimetableCsvImport);
  document.getElementById('btn-export-timetable-csv').addEventListener('click', handleTimetableCsvExport);

  // Schedule List Modal buttons
  document.getElementById('btn-close-schedule-list').addEventListener('click', closeScheduleListModal);
  document.getElementById('btn-add-schedule-new').addEventListener('click', () => {
    openScheduleEditorModal();
  });

  // Schedule Editor Modal buttons
  document.getElementById('btn-close-schedule-editor').addEventListener('click', closeScheduleEditorModal);
  document.getElementById('btn-save-schedule').addEventListener('click', saveScheduleForm);
  document.getElementById('btn-generate-periods').addEventListener('click', autoGeneratePeriods);
  document.getElementById('btn-add-period-row').addEventListener('click', addPeriodRow);
  document.getElementById('btn-import-schedule-csv').addEventListener('click', () => {
    document.getElementById('input-file-schedule-csv').click();
  });
  document.getElementById('input-file-schedule-csv').addEventListener('change', handleScheduleCsvImport);
  document.getElementById('btn-export-schedule-csv').addEventListener('click', handleScheduleCsvExport);

  // Course List Modal buttons
  document.getElementById('btn-close-course-list').addEventListener('click', closeCourseListModal);
  document.getElementById('btn-add-course-list').addEventListener('click', () => {
    openCourseEditorModal(null, state.managingCourseTimetableId);
  });

  // Course Editor Modal buttons
  document.getElementById('btn-close-course-editor').addEventListener('click', closeCourseEditorModal);
  document.getElementById('btn-save-course').addEventListener('click', saveCourseForm);
  document.getElementById('btn-add-session-row').addEventListener('click', () => addSessionEditorCard());

  // Course Detail Sheet buttons
  document.getElementById('btn-close-course-detail').addEventListener('click', closeCourseDetailSheet);
  document.getElementById('btn-edit-course-from-detail').addEventListener('click', () => {
    if (state.selectedCourseDetail) {
      const cid = state.selectedCourseDetail.course.id;
      const tid = state.selectedCourseDetail.course.timetableId;
      closeCourseDetailSheet();
      openCourseEditorModal(cid, tid);
    }
  });

  // Settings Modal buttons
  document.getElementById('btn-close-settings').addEventListener('click', closeSettingsModal);
  bindSettingsEvents();

  // Conflict Dialog buttons
  document.getElementById('btn-conflict-cancel').addEventListener('click', () => {
    document.getElementById('conflict-dialog-overlay').classList.remove('visible');
    state.pendingForceSaveCourse = null;
  });
  document.getElementById('btn-conflict-confirm').addEventListener('click', async () => {
    document.getElementById('conflict-dialog-overlay').classList.remove('visible');
    if (state.pendingForceSaveCourse) {
      const { courseData, sessionsData } = state.pendingForceSaveCourse;
      await saveCourseWithSessions(courseData, sessionsData);
      state.pendingForceSaveCourse = null;
      closeCourseEditorModal();
      await refreshAll();
      showFluidCloudToast('保存成功', '课程已强制保存');
    }
  });
}

// ---------------- Touch Swipe Navigation ----------------
function initTouchSwipe() {
  const scrollArea = document.getElementById('grid-scroll-area');
  let startX = 0;
  let startY = 0;
  let isSwiping = false;

  scrollArea.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isSwiping = true;
    }
  }, { passive: true });

  scrollArea.addEventListener('touchend', (e) => {
    if (!isSwiping || e.changedTouches.length !== 1) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - startX;
    const deltaY = endY - startY;

    // Must be predominantly horizontal with min threshold of 50px
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0 && state.selectedWeek < state.totalWeeks) {
        state.selectedWeek++;
        renderTopBar();
        renderWeekGrid();
      } else if (deltaX > 0 && state.selectedWeek > 1) {
        state.selectedWeek--;
        renderTopBar();
        renderWeekGrid();
      }
    }
    isSwiping = false;
  }, { passive: true });
}

// ---------------- Home Menu Sheet ----------------
function openHomeMenuSheet() {
  const selectEl = document.getElementById('menu-timetable-select');
  selectEl.innerHTML = '';
  state.allTimetables.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.isActive ? `${t.name} (当前)` : t.name;
    if (state.activeTimetable && t.id === state.activeTimetable.id) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  });

  selectEl.onchange = async (e) => {
    const tid = parseInt(e.target.value, 10);
    await setActiveTimetable(tid);
    await refreshAll();
    closeHomeMenuSheet();
  };

  const scheduleNameEl = document.getElementById('menu-schedule-name');
  if (state.activeTimetable) {
    const sch = state.allSchedules.find(s => s.id === state.activeTimetable.scheduleId);
    scheduleNameEl.textContent = sch ? sch.name : '未关联作息表';
  } else {
    scheduleNameEl.textContent = '无';
  }

  const slider = document.getElementById('menu-week-slider');
  slider.max = state.totalWeeks;
  slider.value = state.selectedWeek;
  document.getElementById('menu-week-slider-label').textContent = `第 ${state.selectedWeek} 周 / 共 ${state.totalWeeks} 周`;

  document.getElementById('home-menu-backdrop').classList.add('visible');
}

function closeHomeMenuSheet() {
  document.getElementById('home-menu-backdrop').classList.remove('visible');
}

// ---------------- Course Detail Sheet ----------------
function openCourseDetailSheet(course, session, isCurrentWeek) {
  state.selectedCourseDetail = { course, session, isCurrentWeek };

  document.getElementById('detail-course-name').textContent = course.name;
  document.getElementById('detail-time').textContent = `${DAY_LABELS_FULL[session.dayOfWeek - 1]} 第${session.startPeriod}-${session.endPeriod}节`;
  document.getElementById('detail-current-status').textContent = isCurrentWeek ? '✅ 本周有课' : '⏸️ 非本周课程';
  document.getElementById('detail-location').textContent = session.location ? `地点: ${session.location}` : '地点: 暂无';
  document.getElementById('detail-teacher').textContent = course.teacher ? `教师: ${course.teacher}` : '教师: 暂无';

  let weeksDesc = '所有周';
  if (session.weekType === 'RANGE') {
    weeksDesc = `第 ${session.startWeek || 1}-${session.endWeek || state.totalWeeks} 周`;
  } else if (session.weekType === 'CUSTOM') {
    weeksDesc = `第 ${(session.customWeeks || []).join(',')} 周`;
  }
  document.getElementById('detail-weeks').textContent = `上课周数: ${weeksDesc}`;
  document.getElementById('detail-note').textContent = course.note ? `备注: ${course.note}` : '';

  document.getElementById('course-detail-backdrop').classList.add('visible');
}

function closeCourseDetailSheet() {
  document.getElementById('course-detail-backdrop').classList.remove('visible');
}

// ---------------- Timetable List & Editor ----------------
function openTimetableListModal() {
  const container = document.getElementById('timetable-list-container');
  container.innerHTML = '';

  state.allTimetables.forEach((t) => {
    const sch = state.allSchedules.find(s => s.id === t.scheduleId);
    const item = document.createElement('div');
    item.className = 'entity-list-item';
    item.innerHTML = `
      <div class="entity-info-group">
        <div class="entity-name">
          ${t.name}
          ${t.isActive ? '<span class="entity-badge">当前课表</span>' : ''}
        </div>
        <div class="entity-sub">开学: ${t.startDate} · 共 ${t.totalWeeks} 周 · 作息: ${sch ? sch.name : '默认'}</div>
      </div>
      <div class="entity-actions">
        ${!t.isActive ? `<button class="btn btn-sm btn-outlined btn-set-active">设为当前</button>` : ''}
        <button class="btn btn-sm btn-secondary btn-manage-courses">课程</button>
        <button class="btn btn-sm btn-secondary btn-edit-tt">编辑</button>
        <button class="btn btn-sm btn-danger btn-del-tt">删除</button>
      </div>
    `;

    if (!t.isActive) {
      item.querySelector('.btn-set-active').addEventListener('click', async () => {
        await setActiveTimetable(t.id);
        await refreshAll();
        openTimetableListModal();
      });
    }

    item.querySelector('.btn-manage-courses').addEventListener('click', () => {
      closeTimetableListModal();
      openCourseListModal(t.id);
    });

    item.querySelector('.btn-edit-tt').addEventListener('click', () => {
      openTimetableEditorModal(t.id);
    });

    item.querySelector('.btn-del-tt').addEventListener('click', async () => {
      if (confirm(`确定删除课程表“${t.name}”及其全部课程吗？此操作无法撤销。`)) {
        await deleteTimetable(t.id);
        await refreshAll();
        openTimetableListModal();
      }
    });

    container.appendChild(item);
  });

  document.getElementById('timetable-list-modal').classList.add('visible');
}

function closeTimetableListModal() {
  document.getElementById('timetable-list-modal').classList.remove('visible');
}

async function openTimetableEditorModal(timetableId = null) {
  state.editingTimetableId = timetableId;
  const isEdit = timetableId != null;

  document.getElementById('timetable-editor-title').textContent = isEdit ? '编辑课程表' : '新建课程表';
  document.getElementById('btn-export-timetable-csv').style.display = isEdit ? 'inline-flex' : 'none';
  document.getElementById('btn-import-timetable-csv').style.display = !isEdit ? 'inline-flex' : 'none';

  // Schedule options
  const schSelect = document.getElementById('tt-form-schedule');
  schSelect.innerHTML = '';
  state.allSchedules.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    schSelect.appendChild(opt);
  });

  if (isEdit) {
    const tt = await getTimetableById(timetableId);
    if (!tt) return;
    document.getElementById('tt-form-name').value = tt.name;
    document.getElementById('tt-form-total-weeks').value = tt.totalWeeks;
    document.getElementById('tt-form-start-date').value = tt.startDate;
    schSelect.value = tt.scheduleId;
  } else {
    document.getElementById('tt-form-name').value = '新学期课程表';
    document.getElementById('tt-form-total-weeks').value = 18;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tt-form-start-date').value = today;
    if (state.allSchedules.length > 0) {
      schSelect.value = state.allSchedules[0].id;
    }
  }

  document.getElementById('timetable-editor-modal').classList.add('visible');
}

function closeTimetableEditorModal() {
  document.getElementById('timetable-editor-modal').classList.remove('visible');
  state.editingTimetableId = null;
}

async function saveTimetableForm() {
  const name = document.getElementById('tt-form-name').value.trim();
  const totalWeeks = parseInt(document.getElementById('tt-form-total-weeks').value, 10);
  const startDate = document.getElementById('tt-form-start-date').value;
  const scheduleId = parseInt(document.getElementById('tt-form-schedule').value, 10);

  if (!name) return alert('请填写课程表名称');
  if (isNaN(totalWeeks) || totalWeeks < 1 || totalWeeks > 30) return alert('总周数应在 1 到 30 之间');
  if (!startDate) return alert('请选择开学日期');
  if (isNaN(scheduleId)) return alert('请选择关联作息表');

  const now = Date.now();
  if (state.editingTimetableId) {
    const existing = await getTimetableById(state.editingTimetableId);
    existing.name = name;
    existing.totalWeeks = totalWeeks;
    existing.startDate = startDate;
    existing.scheduleId = scheduleId;
    existing.updatedAt = now;
    await updateTimetable(existing);
  } else {
    const isFirst = (state.allTimetables.length === 0);
    await addTimetable({
      name,
      totalWeeks,
      startDate,
      scheduleId,
      colorScheme: 'default',
      isActive: isFirst,
      createdAt: now,
      updatedAt: now
    });
  }

  closeTimetableEditorModal();
  await refreshAll();
  openTimetableListModal();
  showFluidCloudToast('保存成功', `课程表“${name}”已保存`);
}

async function handleTimetableCsvImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const rawCsv = evt.target.result;
      const totalWeeks = parseInt(document.getElementById('tt-form-total-weeks').value, 10) || 18;
      const scheduleId = parseInt(document.getElementById('tt-form-schedule').value, 10);
      const periods = await getPeriodsBySchedule(scheduleId);
      const maxPeriod = periods.length > 0 ? periods[periods.length - 1].periodNumber : 12;

      const { rows, errors } = parseCourseCsv(rawCsv, totalWeeks, maxPeriod);

      if (errors.length > 0) {
        const errLines = errors.map(er => `第 ${er.rowNumber} 行: ${er.message}`).join('\n');
        alert(`CSV 解析存在错误:\n${errLines}`);
      }

      if (rows.length === 0) {
        alert('CSV 中未解析到有效课程记录');
        return;
      }

      // Create new timetable first
      const name = document.getElementById('tt-form-name').value.trim() || file.name.replace(/\.[^/.]+$/, '');
      const startDate = document.getElementById('tt-form-start-date').value;
      const now = Date.now();

      const timetableId = await addTimetable({
        name,
        totalWeeks,
        startDate,
        scheduleId,
        colorScheme: 'default',
        isActive: true,
        createdAt: now,
        updatedAt: now
      });

      // Group rows by course name
      const grouped = {};
      rows.forEach(r => {
        const key = r.name.toLowerCase();
        if (!grouped[key]) {
          grouped[key] = {
            name: r.name,
            teacher: r.teacher,
            sessions: []
          };
        }
        grouped[key].sessions.push({
          dayOfWeek: r.dayOfWeek,
          startPeriod: r.startPeriod,
          endPeriod: r.endPeriod,
          location: r.location,
          weekType: r.weekType,
          startWeek: r.startWeek,
          endWeek: r.endWeek,
          customWeeks: r.customWeeks
        });
      });

      let colorIdx = 0;
      for (const k in grouped) {
        const item = grouped[k];
        const color = DEFAULT_COURSE_COLORS[colorIdx % DEFAULT_COURSE_COLORS.length];
        colorIdx++;
        await saveCourseWithSessions({
          timetableId,
          name: item.name,
          teacher: item.teacher,
          color,
          note: ''
        }, item.sessions);
      }

      closeTimetableEditorModal();
      await refreshAll();
      showFluidCloudToast('导入成功', `成功导入 ${Object.keys(grouped).length} 门课程并激活课表`);
    } catch (err) {
      alert(`导入异常: ${err.message}`);
    }
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
}

async function handleTimetableCsvExport() {
  if (!state.editingTimetableId) return;
  const tt = await getTimetableById(state.editingTimetableId);
  if (!tt) return;

  const coursesWithSessions = await getCoursesWithSessions(tt.id);
  const csvContent = exportCourseCsv(coursesWithSessions, tt.totalWeeks);

  downloadFile(`${tt.name}_课程表.csv`, 'text/csv;charset=utf-8', csvContent);
  showFluidCloudToast('导出成功', `课程表已导出为 CSV 文件`);
}

// ---------------- Schedule List & Editor ----------------
function openScheduleListModal() {
  const container = document.getElementById('schedule-list-container');
  container.innerHTML = '';

  state.allSchedules.forEach((s) => {
    const isUsed = state.allTimetables.some(t => t.scheduleId === s.id);
    const item = document.createElement('div');
    item.className = 'entity-list-item';
    item.innerHTML = `
      <div class="entity-info-group">
        <div class="entity-name">${s.name} ${isUsed ? '<span class="entity-badge">使用中</span>' : ''}</div>
        <div class="entity-sub">创建时间: ${new Date(s.createdAt).toLocaleDateString()}</div>
      </div>
      <div class="entity-actions">
        <button class="btn btn-sm btn-secondary btn-edit-sch">编辑</button>
        <button class="btn btn-sm btn-danger btn-del-sch">删除</button>
      </div>
    `;

    item.querySelector('.btn-edit-sch').addEventListener('click', () => {
      openScheduleEditorModal(s.id);
    });

    item.querySelector('.btn-del-sch').addEventListener('click', async () => {
      if (isUsed) {
        alert('无法删除正在被课程表使用的作息表，请先在课程表中更换关联作息表。');
        return;
      }
      if (confirm(`确定删除作息表“${s.name}”吗？`)) {
        await deleteSchedule(s.id);
        await refreshAll();
        openScheduleListModal();
      }
    });

    container.appendChild(item);
  });

  document.getElementById('schedule-list-modal').classList.add('visible');
}

function closeScheduleListModal() {
  document.getElementById('schedule-list-modal').classList.remove('visible');
}

async function openScheduleEditorModal(scheduleId = null) {
  state.editingScheduleId = scheduleId;
  const isEdit = scheduleId != null;

  document.getElementById('schedule-editor-title').textContent = isEdit ? '编辑作息表' : '新建作息表';
  document.getElementById('btn-export-schedule-csv').style.display = isEdit ? 'inline-flex' : 'none';
  document.getElementById('btn-import-schedule-csv').style.display = !isEdit ? 'inline-flex' : 'none';

  const rowsContainer = document.getElementById('period-rows-container');
  rowsContainer.innerHTML = '';

  if (isEdit) {
    const sch = await getScheduleById(scheduleId);
    if (!sch) return;
    document.getElementById('sch-form-name').value = sch.name;
    const periods = await getPeriodsBySchedule(scheduleId);
    periods.forEach(p => addPeriodRow(p.startTime, p.endTime));
  } else {
    document.getElementById('sch-form-name').value = '标准作息表';
    // Defaults: 12 periods
    autoGeneratePeriods();
  }

  document.getElementById('schedule-editor-modal').classList.add('visible');
}

function closeScheduleEditorModal() {
  document.getElementById('schedule-editor-modal').classList.remove('visible');
  state.editingScheduleId = null;
}

function autoGeneratePeriods() {
  const startStr = document.getElementById('gen-first-start').value || '08:00';
  const duration = parseInt(document.getElementById('gen-duration').value, 10) || 45;
  const breakMin = parseInt(document.getElementById('gen-break').value, 10) || 10;
  const total = parseInt(document.getElementById('gen-count').value, 10) || 12;

  const [h, m] = startStr.split(':').map(Number);
  let curMins = h * 60 + m;

  const container = document.getElementById('period-rows-container');
  container.innerHTML = '';

  for (let i = 1; i <= total; i++) {
    const startH = Math.floor(curMins / 60).toString().padStart(2, '0');
    const startM = (curMins % 60).toString().padStart(2, '0');
    const endTotalMins = curMins + duration;
    const endH = Math.floor(endTotalMins / 60).toString().padStart(2, '0');
    const endM = (endTotalMins % 60).toString().padStart(2, '0');

    addPeriodRow(`${startH}:${startM}`, `${endH}:${endM}`);

    // Extra lunch & dinner breaks
    if (i === 4) {
      curMins = endTotalMins + 90; // 90 min lunch
    } else if (i === 8) {
      curMins = endTotalMins + 60; // 60 min dinner
    } else {
      curMins = endTotalMins + breakMin;
    }
  }
}

function addPeriodRow(startTime = '08:00', endTime = '08:45') {
  const container = document.getElementById('period-rows-container');
  const count = container.children.length + 1;

  const row = document.createElement('div');
  row.className = 'session-card';
  row.innerHTML = `
    <div class="session-card-header">
      <span class="session-card-title period-index-label">第 ${count} 节</span>
      <button class="btn btn-sm btn-danger btn-del-period">删除</button>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">开始时间</label>
        <input type="time" class="form-control period-start-input" value="${startTime}">
      </div>
      <div class="form-group">
        <label class="form-label">结束时间</label>
        <input type="time" class="form-control period-end-input" value="${endTime}">
      </div>
    </div>
  `;

  row.querySelector('.btn-del-period').addEventListener('click', () => {
    row.remove();
    reindexPeriodRows();
  });

  container.appendChild(row);
}

function reindexPeriodRows() {
  const container = document.getElementById('period-rows-container');
  Array.from(container.children).forEach((child, idx) => {
    child.querySelector('.period-index-label').textContent = `第 ${idx + 1} 节`;
  });
}

async function saveScheduleForm() {
  const name = document.getElementById('sch-form-name').value.trim();
  if (!name) return alert('请填写作息表名称');

  const container = document.getElementById('period-rows-container');
  const rows = Array.from(container.children);
  if (rows.length === 0) return alert('请至少配置一节课');

  const periods = [];
  for (let i = 0; i < rows.length; i++) {
    const sTime = rows[i].querySelector('.period-start-input').value;
    const eTime = rows[i].querySelector('.period-end-input').value;
    if (!sTime || !eTime) return alert(`第 ${i + 1} 节时间不能为空`);
    if (sTime >= eTime) return alert(`第 ${i + 1} 节结束时间必须晚于开始时间`);
    periods.push({
      periodNumber: i + 1,
      startTime: sTime,
      endTime: eTime
    });
  }

  let scheduleId = state.editingScheduleId;
  if (scheduleId) {
    const sch = await getScheduleById(scheduleId);
    sch.name = name;
    await updateSchedule(sch);
    await replaceSchedulePeriods(scheduleId, periods);
  } else {
    scheduleId = await addSchedule({
      name,
      createdAt: Date.now()
    });
    await replaceSchedulePeriods(scheduleId, periods);
  }

  closeScheduleEditorModal();
  await refreshAll();
  openScheduleListModal();
  showFluidCloudToast('保存成功', `作息表“${name}”已保存`);
}

async function handleScheduleCsvImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const rawCsv = evt.target.result;
      const { scheduleName, periods, errors } = parseScheduleCsv(rawCsv);

      if (errors.length > 0) {
        const errLines = errors.map(er => `第 ${er.rowNumber} 行: ${er.message}`).join('\n');
        alert(`CSV 解析存在错误:\n${errLines}`);
      }

      if (periods.length === 0) {
        alert('未解析到有效课节数据');
        return;
      }

      const schId = await addSchedule({
        name: scheduleName || file.name.replace(/\.[^/.]+$/, ''),
        createdAt: Date.now()
      });
      await replaceSchedulePeriods(schId, periods);

      closeScheduleEditorModal();
      await refreshAll();
      openScheduleListModal();
      showFluidCloudToast('导入成功', `成功导入作息表“${scheduleName}”`);
    } catch (err) {
      alert(`导入异常: ${err.message}`);
    }
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
}

async function handleScheduleCsvExport() {
  if (!state.editingScheduleId) return;
  const sch = await getScheduleById(state.editingScheduleId);
  if (!sch) return;

  const periods = await getPeriodsBySchedule(sch.id);
  const csvContent = exportScheduleCsv(sch.name, periods);

  downloadFile(`${sch.name}_作息表.csv`, 'text/csv;charset=utf-8', csvContent);
  showFluidCloudToast('导出成功', `作息表已导出为 CSV 文件`);
}

// ---------------- Course List & Editor ----------------
function openCourseListModal(timetableId) {
  state.managingCourseTimetableId = timetableId;
  const container = document.getElementById('course-list-container');
  container.innerHTML = '';

  const tt = state.allTimetables.find(t => t.id === timetableId);
  document.getElementById('course-list-title').textContent = tt ? `${tt.name} - 课程管理` : '课程管理';

  getCoursesWithSessions(timetableId).then((list) => {
    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--outline);">此课程表暂无课程</div>`;
      return;
    }

    list.forEach((item) => {
      const { course, sessions } = item;
      const sessionSummary = sessions.map(s => {
        return `${DAY_NAMES[s.dayOfWeek - 1]} 第${s.startPeriod}-${s.endPeriod}节`;
      }).join('； ');

      const row = document.createElement('div');
      row.className = 'entity-list-item';
      row.innerHTML = `
        <div class="entity-info-group">
          <div class="entity-name">
            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background-color:${intToHexColor(course.color)};margin-right:4px;"></span>
            ${course.name}
          </div>
          <div class="entity-sub">${course.teacher ? course.teacher + ' · ' : ''}${sessionSummary}</div>
        </div>
        <div class="entity-actions">
          <button class="btn btn-sm btn-secondary btn-edit-course">编辑</button>
          <button class="btn btn-sm btn-danger btn-del-course">删除</button>
        </div>
      `;

      row.querySelector('.btn-edit-course').addEventListener('click', () => {
        openCourseEditorModal(course.id, timetableId);
      });

      row.querySelector('.btn-del-course').addEventListener('click', async () => {
        if (confirm(`确定删除课程“${course.name}”吗？`)) {
          await deleteCourse(course.id);
          await refreshAll();
          openCourseListModal(timetableId);
        }
      });

      container.appendChild(row);
    });
  });

  document.getElementById('course-list-modal').classList.add('visible');
}

function closeCourseListModal() {
  document.getElementById('course-list-modal').classList.remove('visible');
  state.managingCourseTimetableId = null;
}

async function openCourseEditorModal(courseId = null, timetableId = null) {
  state.editingCourseId = courseId;
  state.managingCourseTimetableId = timetableId || (state.activeTimetable ? state.activeTimetable.id : null);

  const isEdit = courseId != null;
  document.getElementById('course-editor-title').textContent = isEdit ? '编辑课程' : '新建课程';

  // Render color swatches
  renderColorSwatches();

  const sessionsContainer = document.getElementById('sessions-editor-container');
  sessionsContainer.innerHTML = '';

  if (isEdit) {
    const detail = await getCourseDetail(courseId);
    if (!detail) return;
    document.getElementById('course-form-name').value = detail.course.name;
    document.getElementById('course-form-teacher').value = detail.course.teacher || '';
    document.getElementById('course-form-note').value = detail.course.note || '';
    selectColorSwatch(intToHexColor(detail.course.color));

    detail.sessions.forEach(sess => addSessionEditorCard(sess));
  } else {
    document.getElementById('course-form-name').value = '';
    document.getElementById('course-form-teacher').value = '';
    document.getElementById('course-form-note').value = '';
    selectColorSwatch(intToHexColor(DEFAULT_COURSE_COLORS[0]));

    // Add 1 default session
    addSessionEditorCard();
  }

  document.getElementById('course-editor-modal').classList.add('visible');
}

function closeCourseEditorModal() {
  document.getElementById('course-editor-modal').classList.remove('visible');
  state.editingCourseId = null;
}

function renderColorSwatches() {
  const container = document.getElementById('course-color-picker');
  container.innerHTML = '';

  DEFAULT_COURSE_COLORS.forEach((c) => {
    const hex = intToHexColor(c);
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = hex;
    swatch.dataset.hex = hex;
    swatch.addEventListener('click', () => selectColorSwatch(hex));
    container.appendChild(swatch);
  });
}

function selectColorSwatch(hex) {
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.hex.toLowerCase() === hex.toLowerCase());
  });
  document.getElementById('course-custom-color').value = hex;
}

function addSessionEditorCard(data = null) {
  const container = document.getElementById('sessions-editor-container');
  const index = container.children.length + 1;

  const card = document.createElement('div');
  card.className = 'session-card';

  const day = data ? data.dayOfWeek : 1;
  const startP = data ? data.startPeriod : 1;
  const endP = data ? data.endPeriod : 2;
  const loc = data ? (data.location || '') : '';
  const weekType = data ? data.weekType : 'ALL';
  const startW = data ? (data.startWeek || 1) : 1;
  const endW = data ? (data.endWeek || state.totalWeeks) : state.totalWeeks;
  const customW = data ? (data.customWeeks || []) : [];

  const maxPeriod = state.periods.length > 0 ? state.periods[state.periods.length - 1].periodNumber : 12;

  let periodOptions = '';
  for (let p = 1; p <= maxPeriod; p++) {
    periodOptions += `<option value="${p}">${p}</option>`;
  }

  card.innerHTML = `
    <div class="session-card-header">
      <span class="session-card-title session-title-num">时间段 ${index}</span>
      <button class="btn btn-sm btn-danger btn-del-session">删除</button>
    </div>

    <div class="form-group">
      <label class="form-label">星期</label>
      <div class="day-selector-pills">
        ${DAY_NAMES.map((name, i) => `
          <div class="day-pill ${day === (i + 1) ? 'active' : ''}" data-day="${i + 1}">${name}</div>
        `).join('')}
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">开始节次</label>
        <select class="form-control session-start-period">${periodOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">结束节次</label>
        <select class="form-control session-end-period">${periodOptions}</select>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">上课地点 (可选)</label>
      <input type="text" class="form-control session-location" placeholder="例如：理教 301" value="${loc}">
    </div>

    <div class="form-group">
      <label class="form-label">周数规则</label>
      <div class="week-type-options">
        <label class="radio-label">
          <input type="radio" name="weekType_${index}" value="ALL" ${weekType === 'ALL' ? 'checked' : ''}> 所有周
        </label>
        <label class="radio-label">
          <input type="radio" name="weekType_${index}" value="RANGE" ${weekType === 'RANGE' ? 'checked' : ''}> 连续范围
        </label>
        <label class="radio-label">
          <input type="radio" name="weekType_${index}" value="CUSTOM" ${weekType === 'CUSTOM' ? 'checked' : ''}> 自定义周
        </label>
      </div>
    </div>

    <div class="session-range-fields form-row" style="display: ${weekType === 'RANGE' ? 'flex' : 'none'};">
      <div class="form-group">
        <label class="form-label">起始周</label>
        <input type="number" class="form-control session-start-week" min="1" max="${state.totalWeeks}" value="${startW}">
      </div>
      <div class="form-group">
        <label class="form-label">结束周</label>
        <input type="number" class="form-control session-end-week" min="1" max="${state.totalWeeks}" value="${endW}">
      </div>
    </div>

    <div class="custom-weeks-selector" style="display: ${weekType === 'CUSTOM' ? 'block' : 'none'};">
      <div class="custom-weeks-actions">
        <button type="button" class="btn btn-sm btn-outlined btn-custom-all">全选</button>
        <button type="button" class="btn btn-sm btn-outlined btn-custom-odd">单周</button>
        <button type="button" class="btn btn-sm btn-outlined btn-custom-even">双周</button>
        <button type="button" class="btn btn-sm btn-outlined btn-custom-clear">清空</button>
      </div>
      <div class="custom-weeks-grid">
        ${Array.from({ length: state.totalWeeks }, (_, i) => i + 1).map(w => `
          <button type="button" class="week-num-btn ${customW.includes(w) ? 'active' : ''}" data-week="${w}">${w}</button>
        `).join('')}
      </div>
    </div>
  `;

  // Set selects
  card.querySelector('.session-start-period').value = startP;
  card.querySelector('.session-end-period').value = endP;

  // Day pills toggle
  card.querySelectorAll('.day-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      card.querySelectorAll('.day-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  // Week type radio toggle
  card.querySelectorAll(`input[name="weekType_${index}"]`).forEach(radio => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      card.querySelector('.session-range-fields').style.display = (val === 'RANGE') ? 'flex' : 'none';
      card.querySelector('.custom-weeks-selector').style.display = (val === 'CUSTOM') ? 'block' : 'none';
    });
  });

  // Custom week toggles
  const customGrid = card.querySelector('.custom-weeks-grid');
  customGrid.querySelectorAll('.week-num-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // Quick select buttons
  card.querySelector('.btn-custom-all').addEventListener('click', () => {
    customGrid.querySelectorAll('.week-num-btn').forEach(b => b.classList.add('active'));
  });
  card.querySelector('.btn-custom-odd').addEventListener('click', () => {
    customGrid.querySelectorAll('.week-num-btn').forEach(b => {
      const w = parseInt(b.dataset.week, 10);
      b.classList.toggle('active', w % 2 === 1);
    });
  });
  card.querySelector('.btn-custom-even').addEventListener('click', () => {
    customGrid.querySelectorAll('.week-num-btn').forEach(b => {
      const w = parseInt(b.dataset.week, 10);
      b.classList.toggle('active', w % 2 === 0);
    });
  });
  card.querySelector('.btn-custom-clear').addEventListener('click', () => {
    customGrid.querySelectorAll('.week-num-btn').forEach(b => b.classList.remove('active'));
  });

  // Delete button
  card.querySelector('.btn-del-session').addEventListener('click', () => {
    card.remove();
    reindexSessionCards();
  });

  container.appendChild(card);
}

function reindexSessionCards() {
  const container = document.getElementById('sessions-editor-container');
  Array.from(container.children).forEach((child, idx) => {
    child.querySelector('.session-title-num').textContent = `时间段 ${idx + 1}`;
  });
}

async function saveCourseForm() {
  const name = document.getElementById('course-form-name').value.trim();
  const teacher = document.getElementById('course-form-teacher').value.trim();
  const note = document.getElementById('course-form-note').value.trim();
  const colorHex = document.getElementById('course-custom-color').value || '#4A90D9';
  const colorInt = hexToIntColor(colorHex);

  if (!name) return alert('请输入课程名称');

  const container = document.getElementById('sessions-editor-container');
  const cards = Array.from(container.children);
  if (cards.length === 0) return alert('请至少添加一个上课时间段');

  const sessions = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const activeDayPill = card.querySelector('.day-pill.active');
    const dayOfWeek = activeDayPill ? parseInt(activeDayPill.dataset.day, 10) : 1;

    const startPeriod = parseInt(card.querySelector('.session-start-period').value, 10);
    const endPeriod = parseInt(card.querySelector('.session-end-period').value, 10);
    if (startPeriod > endPeriod) {
      return alert(`时间段 ${i + 1}：开始节次不能大于结束节次`);
    }

    const location = card.querySelector('.session-location').value.trim();
    const weekTypeRadio = card.querySelector(`input[name^="weekType_"]:checked`);
    const weekType = weekTypeRadio ? weekTypeRadio.value : 'ALL';

    let startWeek = null;
    let endWeek = null;
    let customWeeks = [];

    if (weekType === 'RANGE') {
      startWeek = parseInt(card.querySelector('.session-start-week').value, 10) || 1;
      endWeek = parseInt(card.querySelector('.session-end-week').value, 10) || state.totalWeeks;
      if (startWeek > endWeek) {
        return alert(`时间段 ${i + 1}：起始周不能大于结束周`);
      }
    } else if (weekType === 'CUSTOM') {
      const activeBtns = card.querySelectorAll('.week-num-btn.active');
      customWeeks = Array.from(activeBtns).map(b => parseInt(b.dataset.week, 10)).sort((a, b) => a - b);
      if (customWeeks.length === 0) {
        return alert(`时间段 ${i + 1}：自定义周请至少选中一周`);
      }
    }

    sessions.push({
      dayOfWeek,
      startPeriod,
      endPeriod,
      location,
      weekType,
      startWeek,
      endWeek,
      customWeeks
    });
  }

  const timetableId = state.managingCourseTimetableId || state.activeTimetable.id;

  // Conflict Detection
  const existingCourses = await getCoursesWithSessions(timetableId);
  const conflicts = checkCourseConflicts(existingCourses, sessions, state.totalWeeks, state.editingCourseId);

  if (conflicts.length > 0) {
    state.pendingForceSaveCourse = {
      courseData: {
        id: state.editingCourseId,
        timetableId,
        name,
        teacher,
        color: colorInt,
        note
      },
      sessionsData: sessions
    };

    const conflictListEl = document.getElementById('conflict-list-content');
    conflictListEl.innerHTML = conflicts.map(c => `
      <div style="padding:6px 8px;background:var(--surface-container);border-radius:6px;font-size:0.8rem;">
        ⚠️ 与 <strong>${c.existingCourseName}</strong> 冲突：<br>
        ${DAY_NAMES[c.dayOfWeek - 1]} 第${c.overlapStartPeriod}-${c.overlapEndPeriod}节 · 第 ${c.overlapWeeks.join(',')} 周
      </div>
    `).join('');

    document.getElementById('conflict-dialog-overlay').classList.add('visible');
    return;
  }

  await saveCourseWithSessions({
    id: state.editingCourseId,
    timetableId,
    name,
    teacher,
    color: colorInt,
    note
  }, sessions);

  closeCourseEditorModal();
  await refreshAll();
  if (document.getElementById('course-list-modal').classList.contains('visible')) {
    openCourseListModal(timetableId);
  }
  showFluidCloudToast('保存成功', `课程“${name}”已保存`);
}

// ---------------- Settings Modal ----------------
function openSettingsModal() {
  const settings = state.settings;

  document.getElementById('setting-notify-switch').checked = settings.notificationsEnabled ?? true;

  // Reminder minutes chips
  const minutes = settings.reminderMinutes || 10;
  document.querySelectorAll('.filter-chip[data-min]').forEach(chip => {
    chip.classList.toggle('active', parseInt(chip.dataset.min, 10) === minutes);
  });

  // Theme radios
  const themeMode = settings.themeMode || 'SYSTEM';
  document.querySelectorAll('input[name="themeModeRadio"]').forEach(r => {
    r.checked = (r.value === themeMode);
  });

  // Cell height slider
  const cellHeight = settings.courseCellHeightDp || 68;
  const slider = document.getElementById('setting-cell-height-slider');
  slider.value = cellHeight;
  document.getElementById('setting-cell-height-label').textContent = `${cellHeight} px`;

  // Show non-current
  document.getElementById('setting-show-noncurrent-switch').checked = settings.showNonCurrentWeekCourses ?? true;

  renderWidgetPreviews();

  document.getElementById('settings-modal').classList.add('visible');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('visible');
}

function bindSettingsEvents() {
  // Notification toggle
  document.getElementById('setting-notify-switch').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      await requestNotificationPermission();
    }
    await updateSettings({ notificationsEnabled: enabled });
    state.settings.notificationsEnabled = enabled;
  });

  // Reminder test sound
  document.getElementById('btn-test-chime').addEventListener('click', () => {
    playReminderChime();
    showFluidCloudToast('试听提醒', '正在播放下节上课提示音效');
  });

  // Reminder minutes chips
  document.querySelectorAll('.filter-chip[data-min]').forEach(chip => {
    chip.addEventListener('click', async () => {
      document.querySelectorAll('.filter-chip[data-min]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const min = parseInt(chip.dataset.min, 10);
      await updateSettings({ reminderMinutes: min });
      state.settings.reminderMinutes = min;
    });
  });

  // Theme mode radios
  document.querySelectorAll('input[name="themeModeRadio"]').forEach(r => {
    r.addEventListener('change', async (e) => {
      const mode = e.target.value;
      await updateSettings({ themeMode: mode });
      state.settings.themeMode = mode;
      applyTheme(mode);
    });
  });

  // Cell height slider
  const slider = document.getElementById('setting-cell-height-slider');
  slider.addEventListener('input', async (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('setting-cell-height-label').textContent = `${val} px`;
    await updateSettings({ courseCellHeightDp: val });
    state.settings.courseCellHeightDp = val;
    renderWeekGrid();
  });

  // Non-current switch
  document.getElementById('setting-show-noncurrent-switch').addEventListener('change', async (e) => {
    const checked = e.target.checked;
    await updateSettings({ showNonCurrentWeekCourses: checked });
    state.settings.showNonCurrentWeekCourses = checked;
    renderWeekGrid();
  });

  // Backup & Restore
  document.getElementById('btn-export-backup-json').addEventListener('click', async () => {
    const jsonStr = await exportFullBackupJSON();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadFile(`sleepin_backup_${dateStr}.json`, 'application/json', jsonStr);
    showFluidCloudToast('导出成功', '已生成完整数据备份文件');
  });

  document.getElementById('btn-import-backup-json').addEventListener('click', () => {
    document.getElementById('input-file-backup-json').click();
  });

  document.getElementById('input-file-backup-json').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        await importFullBackupJSON(evt.target.result);
        alert('数据恢复成功！正在重新载入...');
        location.reload();
      } catch (err) {
        alert(`导入备份失败: ${err.message}`);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  // Check update simulation
  document.getElementById('btn-check-update').addEventListener('click', () => {
    const btn = document.getElementById('btn-check-update');
    btn.textContent = '检查中...';
    setTimeout(() => {
      btn.textContent = '检查更新';
      alert('已是最新版本 (v1.0.0 Web Edition)');
    }, 700);
  });
}

function renderWidgetPreviews() {
  const container = document.getElementById('widget-preview-box');
  if (!container || !state.activeTimetable) return;

  const today = new Date();
  const dayOfWeek = (today.getDay() + 6) % 7 + 1; // 1..7

  // Find today's courses
  const todaySessions = [];
  state.courses.forEach(item => {
    item.sessions.forEach(sess => {
      if (sess.dayOfWeek === dayOfWeek) {
        const weeks = resolveWeeks(sess.weekType, sess.startWeek, sess.endWeek, sess.customWeeks, state.totalWeeks);
        if (weeks.has(state.currentWeek || 1)) {
          todaySessions.push({ course: item.course, session: sess });
        }
      }
    });
  });

  todaySessions.sort((a, b) => a.session.startPeriod - b.session.startPeriod);

  container.innerHTML = `
    <div class="widget-preview-card">
      <div class="widget-preview-header">
        <span>📅 今日课程 (${DAY_LABELS_FULL[dayOfWeek - 1]})</span>
        <span>${todaySessions.length} 门课</span>
      </div>
      ${todaySessions.length === 0 ? '<div style="font-size:0.75rem;color:var(--outline);text-align:center;padding:8px;">今天没有排课，好好休息吧~</div>' : ''}
      ${todaySessions.slice(0, 3).map(ts => `
        <div class="widget-item-pill">
          <span>${ts.course.name}</span>
          <span>第${ts.session.startPeriod}-${ts.session.endPeriod}节 ${ts.session.location ? '@' + ts.session.location : ''}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ---------------- Helpers ----------------
function downloadFile(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function checkIosPwaBanner() {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  if (isIos && !isStandalone) {
    const banner = document.getElementById('ios-pwa-banner');
    if (banner) {
      banner.style.display = 'flex';
      document.getElementById('btn-close-ios-banner').addEventListener('click', () => {
        banner.style.display = 'none';
      });
    }
  }
}
