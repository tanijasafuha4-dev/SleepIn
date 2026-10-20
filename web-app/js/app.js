/**
 * SleepIn Web - Main Application Logic
 * Implements MVVM state coordination, navigation, week grid layout,
 * touch gestures, sheets/modals, and PWA setup.
 */

import {
  APP_VERSION,
  DEFAULT_TOTAL_WEEKS,
  DEFAULT_CELL_HEIGHT
} from './config.js';

import {
  seedInitialDataIfNeeded,
  getSettings,
  updateSettings,
  getAllTimetables,
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
  importFullBackupJSON,
  formatLocalDate,
  getIsoDayOfWeek,
  timeToMinutes,
  minutesToTime,
  computeSemesterStatus,
  DEFAULT_MAX_PERIOD,
  STANDARD_14_PERIODS
} from './db.js';

import {
  parseCourseCsv,
  exportCourseCsv,
  parseScheduleCsv,
  exportScheduleCsv,
  validateAndBuildCourseRow
} from './csv.js';

import {
  checkCourseConflicts,
  isSessionInWeek,
  formatSessionWeeks
} from './conflict.js';

import {
  playReminderChime,
  requestNotificationPermission,
  startReminderScheduler,
  showFluidCloudToast
} from './reminder.js';

import {
  DEFAULT_COURSE_COLORS,
  DEFAULT_COURSE_COLOR_HEX,
  intToHexColor,
  hexToIntColor,
  getContrastTextColor,
  applyTheme,
  listenSystemThemeChange
} from './theme.js';

import {
  parseScreenshotWithVisionAPI,
  parseRawTimetableText,
  convertRecordsToSleepInCsv
} from './ocr-parser.js';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripFileExtension(filename) {
  return String(filename || '').replace(/\.[^/.]+$/, '');
}

function formatCsvErrors(errors) {
  return errors.map(er => `第 ${er.rowNumber} 行: ${er.message}`).join('\n');
}

let sessionRadioGroupUid = 0;

// ---------------- App State ----------------
const state = {
  activeTimetable: null,
  allTimetables: [],
  allSchedules: [],
  periods: [],
  courses: [], // CourseWithSessions
  selectedWeek: 1,
  currentWeek: null,
  totalWeeks: DEFAULT_TOTAL_WEEKS,
  semesterStatus: null, // null | '学期未开始' | '学期已结束'
  settings: {},
  selectedCourseDetail: null,
  editingTimetableId: null,
  editingScheduleId: null,
  managingCourseTimetableId: null,
  editingCourseId: null,
  editingCourseMaxPeriod: DEFAULT_MAX_PERIOD,
  editingCourseTotalWeeks: DEFAULT_TOTAL_WEEKS,
  pendingForceSaveCourse: null
};

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_LABELS_FULL = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

// Modal / Bottom Sheet close cleanup callbacks
const MODAL_CLOSE_CLEANUP = {
  'timetable-editor-modal': () => { state.editingTimetableId = null; },
  'schedule-editor-modal': () => { state.editingScheduleId = null; },
  'course-list-modal': () => { state.managingCourseTimetableId = null; },
  'course-editor-modal': () => { state.editingCourseId = null; },
  'conflict-dialog-overlay': () => { state.pendingForceSaveCourse = null; },
  'course-detail-backdrop': () => { state.selectedCourseDetail = null; }
};

function showModal(id) {
  document.getElementById(id)?.classList.add('visible');
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('visible');
  if (MODAL_CLOSE_CLEANUP[id]) {
    MODAL_CLOSE_CLEANUP[id]();
  }
}

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

  // 5. Bind UI event listeners
  bindEvents();

  // 6. Initial refresh of active timetable and views
  await refreshAll();

  // 7. Start unified scheduler for reminders & current time indicator
  startReminderScheduler(() => state, updateCurrentTimeIndicator);
});

// ---------------- Main Data Refresh ----------------
async function refreshAll() {
  state.settings = await getSettings();
  state.allTimetables = await getAllTimetables();
  state.allSchedules = await getAllSchedules();
  state.activeTimetable = state.allTimetables.find(t => t.isActive) || null;

  if (!state.activeTimetable && state.allTimetables.length > 0) {
    state.activeTimetable = state.allTimetables[0];
    state.activeTimetable.isActive = true;
    await setActiveTimetable(state.activeTimetable.id);
  }

  if (state.activeTimetable) {
    calculateSemesterWeek();
    state.periods = await getPeriodsBySchedule(state.activeTimetable.scheduleId);
    state.courses = await getCoursesWithSessions(state.activeTimetable.id);
  } else {
    state.totalWeeks = DEFAULT_TOTAL_WEEKS;
    state.currentWeek = null;
    state.semesterStatus = null;
    state.periods = [];
    state.courses = [];
  }

  renderTopBar();
  renderWeekGrid();
}

// ---------------- Date & Semester Week Calculations ----------------
function calculateSemesterWeek() {
  const { currentWeek, semesterStatus, totalWeeks } = computeSemesterStatus(state.activeTimetable);
  state.totalWeeks = totalWeeks;
  state.currentWeek = currentWeek;
  state.semesterStatus = semesterStatus;

  if (!state.selectedWeek || state.selectedWeek > state.totalWeeks || state.selectedWeek < 1) {
    state.selectedWeek = state.currentWeek || 1;
  }
}

function goToWeek(targetWeek) {
  const clamped = Math.max(1, Math.min(state.totalWeeks, Number(targetWeek) || 1));
  if (clamped !== state.selectedWeek) {
    state.selectedWeek = clamped;
    renderTopBar();
    renderWeekGrid();
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
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const dayName = DAY_LABELS_FULL[getIsoDayOfWeek(now) - 1];

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

  // Apply CSS custom properties for row height and period count
  const rowHeight = state.settings.courseCellHeightDp || DEFAULT_CELL_HEIGHT;
  document.documentElement.style.setProperty('--cell-height', `${rowHeight}px`);
  document.documentElement.style.setProperty('--period-count', String(state.periods.length));

  // Render Header Dates
  const headerContainer = document.getElementById('days-header-container');
  headerContainer.innerHTML = '';

  const dates = getWeekDates(state.activeTimetable.startDate, state.selectedWeek);
  const todayColumnIndex = (state.currentWeek === state.selectedWeek)
    ? getIsoDayOfWeek(new Date()) - 1
    : null;

  dates.forEach((d, idx) => {
    const isToday = (todayColumnIndex === idx);
    const cell = document.createElement('div');
    cell.className = `day-header-cell ${isToday ? 'today' : ''}`;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayDate = String(d.getDate()).padStart(2, '0');
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

  // Render Column Overlay with Today Highlight
  const colsOverlay = document.getElementById('grid-cols-overlay');
  colsOverlay.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const col = document.createElement('div');
    col.className = `grid-column-line ${todayColumnIndex === i ? 'today-col' : ''}`;
    colsOverlay.appendChild(col);
  }

  // Render Course Cards
  renderCourseCards();

  // Update Red Current Time Line
  updateCurrentTimeIndicator();
}

function renderCourseCards() {
  const container = document.getElementById('course-cells-layer');
  container.innerHTML = '';

  const showNonCurrent = state.settings.showNonCurrentWeekCourses ?? true;
  const visibleItems = [];

  state.courses.forEach(({ course, sessions }) => {
    sessions.forEach((sess) => {
      const isCurrentWeek = isSessionInWeek(sess, state.selectedWeek, state.totalWeeks);
      if (isCurrentWeek || showNonCurrent) {
        visibleItems.push({ course, session: sess, isCurrentWeek });
      }
    });
  });

  // Render non-current week courses first so current week courses always sit on top
  visibleItems.sort((a, b) => Number(a.isCurrentWeek) - Number(b.isCurrentWeek));

  visibleItems.forEach(({ course, session, isCurrentWeek }) => {
    const dayIdx = session.dayOfWeek - 1; // 0..6
    if (dayIdx < 0 || dayIdx > 6) return;

    const startRow = session.startPeriod - 1;
    const span = session.endPeriod - session.startPeriod + 1;
    const leftPercent = dayIdx * (100 / 7);
    const widthPercent = 100 / 7;

    const hexColor = intToHexColor(course.color);
    const textColor = getContrastTextColor(hexColor);

    const card = document.createElement('div');
    card.className = `course-cell-card ${!isCurrentWeek ? 'non-current' : ''}`;
    card.style.setProperty('--start-row', String(startRow));
    card.style.setProperty('--span', String(span));
    card.style.left = `calc(${leftPercent}% + 2px)`;
    card.style.width = `calc(${widthPercent}% - 4px)`;
    card.style.backgroundColor = hexColor;
    card.style.color = textColor;

    const nonCurrentBadge = !isCurrentWeek ? `<div class="cell-non-current-badge">非本周</div>` : '';
    const locStr = session.location ? `<div class="cell-location">@${escapeHtml(session.location)}</div>` : '';
    const teacherStr = course.teacher ? `<div class="cell-teacher">${escapeHtml(course.teacher)}</div>` : '';

    card.innerHTML = `
      ${nonCurrentBadge}
      <div class="cell-title">${escapeHtml(course.name)}</div>
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
  const periods = state.periods;
  let offsetRows = null;

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const pStart = timeToMinutes(p.startTime);
    const pEnd = timeToMinutes(p.endTime);

    if (currentMinutes >= pStart && currentMinutes < pEnd) {
      offsetRows = i + ((currentMinutes - pStart) / Math.max(1, pEnd - pStart));
      break;
    }

    const nextP = periods[i + 1];
    if (nextP) {
      const nextStart = timeToMinutes(nextP.startTime);
      if (currentMinutes >= pEnd && currentMinutes < nextStart) {
        offsetRows = i + 1;
        break;
      }
    }
  }

  if (offsetRows != null) {
    lineEl.style.setProperty('--offset-rows', String(offsetRows));
    lineEl.style.display = 'block';
  } else {
    lineEl.style.display = 'none';
  }
}

// ---------------- UI Event Handlers ----------------
function bindEvents() {
  // Week navigation arrows
  document.getElementById('btn-prev-week').addEventListener('click', () => {
    goToWeek(state.selectedWeek - 1);
  });

  document.getElementById('btn-next-week').addEventListener('click', () => {
    goToWeek(state.selectedWeek + 1);
  });

  // Home Menu Sheet button & quick add course
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

  // Unified backdrop click handler for all modals and bottom sheets
  document.querySelectorAll('.modal-overlay, .sheet-backdrop').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        hideModal(overlay.id);
      }
    });
  });

  // Home Menu Sheet Actions
  document.getElementById('menu-tile-timetable').addEventListener('click', () => {
    hideModal('home-menu-backdrop');
    openTimetableListModal();
  });
  document.getElementById('menu-tile-schedule').addEventListener('click', () => {
    hideModal('home-menu-backdrop');
    openScheduleListModal();
  });
  document.getElementById('menu-tile-settings').addEventListener('click', () => {
    hideModal('home-menu-backdrop');
    openSettingsModal();
  });

  // Menu week slider
  const weekSlider = document.getElementById('menu-week-slider');
  weekSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('menu-week-slider-label').textContent = `第 ${val} 周 / 共 ${state.totalWeeks} 周`;
    goToWeek(val);
  });

  // Empty state buttons
  document.getElementById('btn-empty-create-timetable').addEventListener('click', () => {
    openTimetableEditorModal();
  });

  // Timetable List Modal buttons
  document.getElementById('btn-close-timetable-list').addEventListener('click', () => hideModal('timetable-list-modal'));
  document.getElementById('btn-add-timetable-new').addEventListener('click', () => openTimetableEditorModal());

  // Timetable Editor Modal buttons
  document.getElementById('btn-close-timetable-editor').addEventListener('click', () => hideModal('timetable-editor-modal'));
  document.getElementById('btn-save-timetable').addEventListener('click', saveTimetableForm);
  document.getElementById('btn-import-timetable-csv').addEventListener('click', () => {
    document.getElementById('input-file-timetable-csv').click();
  });
  document.getElementById('input-file-timetable-csv').addEventListener('change', handleTimetableCsvImport);
  document.getElementById('btn-export-timetable-csv').addEventListener('click', handleTimetableCsvExport);

  // Schedule List Modal buttons
  document.getElementById('btn-close-schedule-list').addEventListener('click', () => hideModal('schedule-list-modal'));
  document.getElementById('btn-add-schedule-new').addEventListener('click', () => openScheduleEditorModal());

  // Schedule Editor Modal buttons
  document.getElementById('btn-close-schedule-editor').addEventListener('click', () => hideModal('schedule-editor-modal'));
  document.getElementById('btn-save-schedule').addEventListener('click', saveScheduleForm);
  document.getElementById('btn-generate-periods').addEventListener('click', autoGeneratePeriods);
  document.getElementById('btn-add-period-row').addEventListener('click', () => addPeriodRow());
  document.getElementById('btn-restore-14-periods')?.addEventListener('click', () => {
    fillPeriodRows(STANDARD_14_PERIODS);
  });
  document.getElementById('btn-import-schedule-csv').addEventListener('click', () => {
    document.getElementById('input-file-schedule-csv').click();
  });
  document.getElementById('input-file-schedule-csv').addEventListener('change', handleScheduleCsvImport);
  document.getElementById('btn-export-schedule-csv').addEventListener('click', handleScheduleCsvExport);

  // Course List Modal buttons
  document.getElementById('btn-close-course-list').addEventListener('click', () => hideModal('course-list-modal'));
  document.getElementById('btn-add-course-list').addEventListener('click', () => {
    openCourseEditorModal(null, state.managingCourseTimetableId);
  });

  // Course Editor Modal buttons
  document.getElementById('btn-close-course-editor').addEventListener('click', () => hideModal('course-editor-modal'));
  document.getElementById('btn-save-course').addEventListener('click', saveCourseForm);
  document.getElementById('btn-add-session-row').addEventListener('click', () => addSessionEditorCard());

  // Course Detail Sheet buttons
  document.getElementById('btn-close-course-detail').addEventListener('click', () => hideModal('course-detail-backdrop'));
  document.getElementById('btn-edit-course-from-detail').addEventListener('click', () => {
    if (state.selectedCourseDetail) {
      const { id: cid, timetableId: tid } = state.selectedCourseDetail;
      hideModal('course-detail-backdrop');
      openCourseEditorModal(cid, tid);
    }
  });

  // Settings Modal buttons
  document.getElementById('btn-close-settings').addEventListener('click', () => hideModal('settings-modal'));
  bindSettingsEvents();

  // Conflict Dialog buttons
  document.getElementById('btn-conflict-cancel').addEventListener('click', () => {
    hideModal('conflict-dialog-overlay');
  });
  document.getElementById('btn-conflict-confirm').addEventListener('click', async () => {
    const pending = state.pendingForceSaveCourse;
    hideModal('conflict-dialog-overlay');
    if (pending) {
      await commitCourseSave(pending.courseData, pending.sessionsData, '课程已强制保存');
    }
  });

  // Initialize Screenshot to CSV Feature
  initScreenshotCsvFeature();
}

function getMaxPeriodFromList(periods) {
  return periods && periods.length > 0
    ? periods[periods.length - 1].periodNumber
    : DEFAULT_MAX_PERIOD;
}

async function getMaxPeriodForSchedule(scheduleId) {
  const periods = await getPeriodsBySchedule(scheduleId);
  return getMaxPeriodFromList(periods);
}

function reindexChildren(containerId, labelSelector, formatLabel) {
  const container = document.getElementById(containerId);
  if (!container) return;
  Array.from(container.children).forEach((child, idx) => {
    const labelEl = child.querySelector(labelSelector);
    if (labelEl) labelEl.textContent = formatLabel(idx + 1);
  });
}

async function importCourseRowsToTimetable(timetableId, rows, defaultNote = '') {
  const grouped = {};
  rows.forEach((r) => {
    const key = `${r.name.trim().toLowerCase()}__${(r.teacher || '').trim().toLowerCase()}`;
    if (!grouped[key]) {
      grouped[key] = {
        name: r.name,
        teacher: r.teacher || '',
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
  const entries = Object.values(grouped);
  for (const item of entries) {
    const color = DEFAULT_COURSE_COLORS[colorIdx % DEFAULT_COURSE_COLORS.length];
    colorIdx++;
    await saveCourseWithSessions({
      timetableId,
      name: item.name,
      teacher: item.teacher,
      color,
      note: defaultNote
    }, item.sessions);
  }
  return entries.length;
}

// ---------------- Screenshot & OCR to CSV Feature ----------------
function initScreenshotCsvFeature() {
  let currentScreenshotBase64 = null;
  const modal = document.getElementById('screenshot-csv-modal');
  const openBtn = document.getElementById('btn-open-screenshot-csv');
  const closeBtn = document.getElementById('btn-close-screenshot-csv');

  if (!modal || !openBtn) return;

  openBtn.addEventListener('click', () => showModal('screenshot-csv-modal'));
  closeBtn.addEventListener('click', () => hideModal('screenshot-csv-modal'));

  // Tab switching
  const tabImage = document.getElementById('tab-btn-image-mode');
  const tabText = document.getElementById('tab-btn-text-mode');
  const panelImage = document.getElementById('panel-image-mode');
  const panelText = document.getElementById('panel-text-mode');

  const switchOcrTab = (isImageMode) => {
    tabImage.className = `btn btn-sm ${isImageMode ? 'btn-primary' : 'btn-outlined'}`;
    tabText.className = `btn btn-sm ${!isImageMode ? 'btn-primary' : 'btn-outlined'}`;
    panelImage.style.display = isImageMode ? 'flex' : 'none';
    panelText.style.display = !isImageMode ? 'flex' : 'none';
  };

  tabImage.addEventListener('click', () => switchOcrTab(true));
  tabText.addEventListener('click', () => switchOcrTab(false));

  // Drag & drop file selection
  const dropzone = document.getElementById('dropzone-screenshot');
  const fileInput = document.getElementById('input-screenshot-file');
  const previewBox = document.getElementById('dropzone-preview');
  const promptBox = document.getElementById('dropzone-prompt');
  const previewImg = document.getElementById('img-screenshot-preview');
  const reselectBtn = document.getElementById('btn-reselect-image');

  dropzone.addEventListener('click', (e) => {
    if (e.target !== reselectBtn) {
      fileInput.click();
    }
  });

  reselectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-active');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-active');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFile(e.target.files[0]);
    }
  });

  // Paste image directly (Ctrl+V)
  window.addEventListener('paste', (e) => {
    if (!modal.classList.contains('visible')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleImageFile(file);
          showFluidCloudToast('已粘贴截图', '检测到剪贴板图片并载入');
          break;
        }
      }
    }
  });

  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      currentScreenshotBase64 = evt.target.result;
      previewImg.src = currentScreenshotBase64;
      promptBox.style.display = 'none';
      previewBox.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  // Start Vision Parse
  const parseBtn = document.getElementById('btn-start-vision-parse');
  parseBtn.addEventListener('click', async () => {
    if (!currentScreenshotBase64) {
      alert('请先上传或粘贴课表截图！');
      return;
    }

    parseBtn.disabled = true;
    const originalText = parseBtn.innerHTML;
    parseBtn.innerHTML = '<span>⏳ 正在调用 AI 视觉大模型深度识别中，请稍候...</span>';

    try {
      const records = await parseScreenshotWithVisionAPI({
        imageBase64: currentScreenshotBase64
      });

      renderParsedTable(records);
      showFluidCloudToast('识别完成', `成功识别出 ${records.length} 条课程时段！`);
    } catch (err) {
      alert(`识别失败：${err.message}`);
    } finally {
      parseBtn.disabled = false;
      parseBtn.innerHTML = originalText;
    }
  });

  // Start Text Parse
  const textParseBtn = document.getElementById('btn-start-text-parse');
  textParseBtn.addEventListener('click', () => {
    const rawText = document.getElementById('input-raw-timetable-text').value.trim();
    if (!rawText) {
      alert('请先粘贴课表文本内容！');
      return;
    }

    const records = parseRawTimetableText(rawText);
    if (records.length === 0) {
      alert('未能从文本中匹配到符合规范的星期或节次信息，请检查格式或切换到截图识别');
      return;
    }

    renderParsedTable(records);
    showFluidCloudToast('提取完成', `成功提取出 ${records.length} 条课程时段！`);
  });

  // Render & Edit Table
  const tbody = document.getElementById('parsed-records-tbody');
  const countBadge = document.getElementById('parsed-count-badge');
  const wrapper = document.getElementById('parsed-results-wrapper');
  const footerActions = document.getElementById('parsed-footer-actions');

  function renderParsedTable(records) {
    tbody.innerHTML = '';
    countBadge.textContent = records.length;
    wrapper.style.display = 'block';
    footerActions.style.display = 'flex';

    records.forEach(r => addParsedRowToTable(r));
  }

  function addParsedRowToTable(r = {}) {
    const tr = document.createElement('tr');
    tr.className = 'parsed-table-row';

    const day = r.dayOfWeek || 1;
    const maxPeriod = getMaxPeriodFromList(state.periods);
    const dayOptions = [1, 2, 3, 4, 5, 6, 7].map(d => `
      <option value="${d}" ${d === day ? 'selected' : ''}>${DAY_NAMES[d - 1]}</option>
    `).join('');

    tr.innerHTML = `
      <td class="parsed-cell">
        <input type="text" class="p-name form-control parsed-input" value="${escapeHtml(r.name || '')}" placeholder="课程名">
      </td>
      <td class="parsed-cell">
        <select class="p-day form-control parsed-select">
          ${dayOptions}
        </select>
      </td>
      <td class="parsed-cell-nowrap">
        <input type="number" class="p-start-period form-control parsed-period-input" min="1" max="${maxPeriod}" value="${Number(r.startPeriod) || 1}">
        -
        <input type="number" class="p-end-period form-control parsed-period-input" min="1" max="${maxPeriod}" value="${Number(r.endPeriod) || 2}">
      </td>
      <td class="parsed-cell">
        <input type="text" class="p-weeks form-control parsed-weeks-input" value="${escapeHtml(r.weeks || 'ALL')}" placeholder="1-16">
      </td>
      <td class="parsed-cell">
        <input type="text" class="p-location form-control parsed-input" value="${escapeHtml(r.location || '')}" placeholder="教室">
      </td>
      <td class="parsed-cell">
        <input type="text" class="p-teacher form-control parsed-input" value="${escapeHtml(r.teacher || '')}" placeholder="教师">
      </td>
      <td class="parsed-cell-center">
        <button type="button" class="btn btn-sm btn-danger p-del-btn parsed-del-btn">✕</button>
      </td>
    `;

    tr.querySelector('.p-del-btn').addEventListener('click', () => {
      tr.remove();
      countBadge.textContent = tbody.children.length;
    });

    tbody.appendChild(tr);
    countBadge.textContent = tbody.children.length;
  }

  // Add empty row
  document.getElementById('btn-add-parsed-row').addEventListener('click', () => {
    addParsedRowToTable({
      name: '',
      dayOfWeek: 1,
      startPeriod: 1,
      endPeriod: 2,
      weeks: 'ALL',
      location: '',
      teacher: ''
    });
  });

  function getRecordsFromTable() {
    const rows = Array.from(tbody.children);
    const records = [];

    rows.forEach((tr) => {
      const name = tr.querySelector('.p-name').value.trim();
      if (!name) return;
      const day = parseInt(tr.querySelector('.p-day').value, 10);
      const startP = parseInt(tr.querySelector('.p-start-period').value, 10) || 1;
      const endP = parseInt(tr.querySelector('.p-end-period').value, 10) || startP;
      const weeks = tr.querySelector('.p-weeks').value.trim() || 'ALL';
      const location = tr.querySelector('.p-location').value.trim();
      const teacher = tr.querySelector('.p-teacher').value.trim();

      records.push({
        name,
        dayOfWeek: day,
        startPeriod: startP,
        endPeriod: endP,
        weeks,
        location,
        teacher
      });
    });

    return records;
  }

  // Export to CSV
  document.getElementById('btn-download-parsed-csv').addEventListener('click', () => {
    const records = getRecordsFromTable();
    if (records.length === 0) {
      alert('表格中暂无有效课程数据！');
      return;
    }

    const csvStr = convertRecordsToSleepInCsv(records);
    downloadFile('课表识别导出.csv', 'text/csv;charset=utf-8', csvStr);
    showFluidCloudToast('导出成功', '已生成并下载 SleepIn 标准 CSV 课表文件！');
  });

  // Import to Active Timetable directly without round-tripping through CSV serialization
  document.getElementById('btn-import-parsed-to-active').addEventListener('click', async () => {
    if (!state.activeTimetable) {
      alert('请先选择或创建一个当前激活的课程表！');
      return;
    }

    const records = getRecordsFromTable();
    if (records.length === 0) {
      alert('表格中暂无有效课程数据！');
      return;
    }

    if (!confirm(`确认将这 ${records.length} 条课程时段直接导入到【${state.activeTimetable.name}】中吗？`)) {
      return;
    }

    const maxPeriod = await getMaxPeriodForSchedule(state.activeTimetable.scheduleId);
    const rows = [];
    const errors = [];

    records.forEach((rec, idx) => {
      try {
        rows.push(validateAndBuildCourseRow(rec, state.totalWeeks, maxPeriod));
      } catch (err) {
        errors.push({ rowNumber: idx + 1, message: err.message });
      }
    });

    if (errors.length > 0) {
      alert(`导入校验存在问题：\n${formatCsvErrors(errors)}`);
      return;
    }

    const importedCourseCount = await importCourseRowsToTimetable(
      state.activeTimetable.id,
      rows,
      '截图智能导入'
    );

    hideModal('screenshot-csv-modal');
    await refreshAll();
    showFluidCloudToast('导入成功', `成功将 ${importedCourseCount} 门课程导入到当前课表！`);
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
    const deltaX = e.changedTouches[0].clientX - startX;
    const deltaY = e.changedTouches[0].clientY - startY;

    // Must be predominantly horizontal with min threshold of 50px
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      goToWeek(state.selectedWeek + (deltaX < 0 ? 1 : -1));
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
    hideModal('home-menu-backdrop');
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

  showModal('home-menu-backdrop');
}

// ---------------- Course Detail Sheet ----------------
function openCourseDetailSheet(course, session, isCurrentWeek) {
  state.selectedCourseDetail = { id: course.id, timetableId: course.timetableId };

  document.getElementById('detail-course-name').textContent = course.name;
  document.getElementById('detail-time').textContent = `${DAY_LABELS_FULL[session.dayOfWeek - 1]} 第${session.startPeriod}-${session.endPeriod}节`;
  document.getElementById('detail-current-status').textContent = isCurrentWeek ? '✅ 本周有课' : '⏸️ 非本周课程';
  document.getElementById('detail-location').textContent = session.location ? `地点: ${session.location}` : '地点: 暂无';
  document.getElementById('detail-teacher').textContent = course.teacher ? `教师: ${course.teacher}` : '教师: 暂无';
  document.getElementById('detail-weeks').textContent = `上课周数: ${formatSessionWeeks(session, state.totalWeeks, 'ui')}`;
  document.getElementById('detail-note').textContent = course.note ? `备注: ${course.note}` : '';

  showModal('course-detail-backdrop');
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
          ${escapeHtml(t.name)}
          ${t.isActive ? '<span class="entity-badge">当前课表</span>' : ''}
        </div>
        <div class="entity-sub">开学: ${escapeHtml(t.startDate)} · 共 ${Number(t.totalWeeks) || DEFAULT_TOTAL_WEEKS} 周 · 作息: ${escapeHtml(sch ? sch.name : '默认')}</div>
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
      hideModal('timetable-list-modal');
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

  showModal('timetable-list-modal');
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
    document.getElementById('tt-form-total-weeks').value = DEFAULT_TOTAL_WEEKS;
    document.getElementById('tt-form-start-date').value = formatLocalDate();
    if (state.allSchedules.length > 0) {
      schSelect.value = state.allSchedules[0].id;
    }
  }

  showModal('timetable-editor-modal');
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

  hideModal('timetable-editor-modal');
  await refreshAll();
  openTimetableListModal();
  showFluidCloudToast('保存成功', `课程表“${name}”已保存`);
}

async function handleTimetableCsvImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  try {
    const rawCsv = await file.text();
    const totalWeeks = parseInt(document.getElementById('tt-form-total-weeks').value, 10) || DEFAULT_TOTAL_WEEKS;
    const scheduleId = parseInt(document.getElementById('tt-form-schedule').value, 10);
    const maxPeriod = await getMaxPeriodForSchedule(scheduleId);

    const { rows, errors } = parseCourseCsv(rawCsv, totalWeeks, maxPeriod);

    if (errors.length > 0) {
      alert(`CSV 解析存在错误:\n${formatCsvErrors(errors)}`);
    }

    if (rows.length === 0) {
      alert('CSV 中未解析到有效课程记录');
      return;
    }

    // Create new timetable and set it as the sole active timetable
    const name = document.getElementById('tt-form-name').value.trim() || stripFileExtension(file.name);
    const startDate = document.getElementById('tt-form-start-date').value || formatLocalDate();
    const now = Date.now();

    const timetableId = await addTimetable({
      name,
      totalWeeks,
      startDate,
      scheduleId,
      colorScheme: 'default',
      isActive: false,
      createdAt: now,
      updatedAt: now
    });

    await setActiveTimetable(timetableId);
    const importedCourseCount = await importCourseRowsToTimetable(timetableId, rows, '');

    hideModal('timetable-editor-modal');
    await refreshAll();
    showFluidCloudToast('导入成功', `成功导入 ${importedCourseCount} 门课程并激活课表`);
  } catch (err) {
    alert(`导入异常: ${err.message}`);
  }
}

async function handleTimetableCsvExport() {
  if (!state.editingTimetableId) return;
  const tt = await getTimetableById(state.editingTimetableId);
  if (!tt) return;

  const coursesWithSessions = await getCoursesWithSessions(tt.id);
  const csvContent = exportCourseCsv(coursesWithSessions, tt.totalWeeks);

  downloadFile(`${tt.name}_课程表.csv`, 'text/csv;charset=utf-8', csvContent);
  showFluidCloudToast('导出成功', '课程表已导出为 CSV 文件');
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
        <div class="entity-name">${escapeHtml(s.name)} ${isUsed ? '<span class="entity-badge">使用中</span>' : ''}</div>
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

  showModal('schedule-list-modal');
}

function fillPeriodRows(periods = STANDARD_14_PERIODS) {
  const rowsContainer = document.getElementById('period-rows-container');
  rowsContainer.innerHTML = '';
  const list = (periods && periods.length > 0) ? periods : STANDARD_14_PERIODS;
  list.forEach(p => addPeriodRow(p.startTime, p.endTime));
}

async function openScheduleEditorModal(scheduleId = null) {
  state.editingScheduleId = scheduleId;
  const isEdit = scheduleId != null;

  document.getElementById('schedule-editor-title').textContent = isEdit ? '编辑作息表' : '新建作息表';
  document.getElementById('btn-export-schedule-csv').style.display = isEdit ? 'inline-flex' : 'none';
  document.getElementById('btn-import-schedule-csv').style.display = !isEdit ? 'inline-flex' : 'none';

  if (isEdit) {
    const sch = await getScheduleById(scheduleId);
    if (!sch) return;
    document.getElementById('sch-form-name').value = sch.name;
    const periods = await getPeriodsBySchedule(scheduleId);
    fillPeriodRows(periods);
  } else {
    document.getElementById('sch-form-name').value = '标准作息表';
    fillPeriodRows(STANDARD_14_PERIODS);
  }

  showModal('schedule-editor-modal');
}

function autoGeneratePeriods() {
  const startStr = document.getElementById('gen-first-start').value || '08:00';
  const duration = parseInt(document.getElementById('gen-duration').value, 10) || 45;
  const breakMin = parseInt(document.getElementById('gen-break').value, 10) || 10;
  const total = parseInt(document.getElementById('gen-count').value, 10) || DEFAULT_MAX_PERIOD;

  let curMins = timeToMinutes(startStr);

  const container = document.getElementById('period-rows-container');
  container.innerHTML = '';

  for (let i = 1; i <= total; i++) {
    const endTotalMins = curMins + duration;
    addPeriodRow(minutesToTime(curMins), minutesToTime(endTotalMins));

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
        <input type="time" class="form-control period-start-input" value="${escapeHtml(startTime)}">
      </div>
      <div class="form-group">
        <label class="form-label">结束时间</label>
        <input type="time" class="form-control period-end-input" value="${escapeHtml(endTime)}">
      </div>
    </div>
  `;

  row.querySelector('.btn-del-period').addEventListener('click', () => {
    row.remove();
    reindexChildren('period-rows-container', '.period-index-label', n => `第 ${n} 节`);
  });

  container.appendChild(row);
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
  } else {
    scheduleId = await addSchedule({
      name,
      createdAt: Date.now()
    });
  }
  await replaceSchedulePeriods(scheduleId, periods);

  hideModal('schedule-editor-modal');
  await refreshAll();
  openScheduleListModal();
  showFluidCloudToast('保存成功', `作息表“${name}”已保存`);
}

async function handleScheduleCsvImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  try {
    const rawCsv = await file.text();
    const { scheduleName, periods, errors } = parseScheduleCsv(rawCsv);

    if (errors.length > 0) {
      alert(`CSV 解析存在错误:\n${formatCsvErrors(errors)}`);
    }

    if (periods.length === 0) {
      alert('未解析到有效课节数据');
      return;
    }

    const finalScheduleName = scheduleName || stripFileExtension(file.name);
    const schId = await addSchedule({
      name: finalScheduleName,
      createdAt: Date.now()
    });
    await replaceSchedulePeriods(schId, periods);

    hideModal('schedule-editor-modal');
    await refreshAll();
    openScheduleListModal();
    showFluidCloudToast('导入成功', `成功导入作息表“${finalScheduleName}”`);
  } catch (err) {
    alert(`导入异常: ${err.message}`);
  }
}

async function handleScheduleCsvExport() {
  if (!state.editingScheduleId) return;
  const sch = await getScheduleById(state.editingScheduleId);
  if (!sch) return;

  const periods = await getPeriodsBySchedule(sch.id);
  const csvContent = exportScheduleCsv(sch.name, periods);

  downloadFile(`${sch.name}_作息表.csv`, 'text/csv;charset=utf-8', csvContent);
  showFluidCloudToast('导出成功', '作息表已导出为 CSV 文件');
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
      container.innerHTML = `<div class="empty-list-placeholder">此课程表暂无课程</div>`;
      return;
    }

    list.forEach(({ course, sessions }) => {
      const sessionSummary = sessions.map(s => `${DAY_NAMES[s.dayOfWeek - 1]} 第${s.startPeriod}-${s.endPeriod}节`).join('； ');

      const row = document.createElement('div');
      row.className = 'entity-list-item';
      row.innerHTML = `
        <div class="entity-info-group">
          <div class="entity-name">
            <span class="course-color-dot" style="background-color:${intToHexColor(course.color)};"></span>
            ${escapeHtml(course.name)}
          </div>
          <div class="entity-sub">${course.teacher ? escapeHtml(course.teacher) + ' · ' : ''}${escapeHtml(sessionSummary)}</div>
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

  showModal('course-list-modal');
}

async function openCourseEditorModal(courseId = null, timetableId = null) {
  state.editingCourseId = courseId;
  const resolvedTimetableId = timetableId || (state.activeTimetable ? state.activeTimetable.id : null);
  state.managingCourseTimetableId = resolvedTimetableId;

  // Resolve target timetable's own maxPeriod and totalWeeks (even if editing a non-active timetable)
  const targetTt = state.allTimetables.find(t => t.id === resolvedTimetableId) || state.activeTimetable;
  if (targetTt) {
    state.editingCourseMaxPeriod = await getMaxPeriodForSchedule(targetTt.scheduleId);
    state.editingCourseTotalWeeks = Number(targetTt.totalWeeks) || DEFAULT_TOTAL_WEEKS;
  } else {
    state.editingCourseMaxPeriod = getMaxPeriodFromList(state.periods);
    state.editingCourseTotalWeeks = state.totalWeeks;
  }

  const isEdit = courseId != null;
  document.getElementById('course-editor-title').textContent = isEdit ? '编辑课程' : '新建课程';

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
    selectColorSwatch(DEFAULT_COURSE_COLOR_HEX);

    addSessionEditorCard();
  }

  showModal('course-editor-modal');
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
  const radioGroupName = `weekType_${++sessionRadioGroupUid}`;

  const card = document.createElement('div');
  card.className = 'session-card';

  const targetTotalWeeks = state.editingCourseTotalWeeks || state.totalWeeks;
  const maxPeriod = state.editingCourseMaxPeriod || getMaxPeriodFromList(state.periods);

  const day = data ? data.dayOfWeek : 1;
  const startP = data ? data.startPeriod : 1;
  const endP = data ? data.endPeriod : 2;
  const loc = data ? (data.location || '') : '';
  const weekType = data ? data.weekType : 'ALL';
  const startW = data ? (data.startWeek || 1) : 1;
  const endW = data ? (data.endWeek || targetTotalWeeks) : targetTotalWeeks;
  const customW = data ? (data.customWeeks || []) : [];

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
      <input type="text" class="form-control session-location" placeholder="例如：理教 301" value="${escapeHtml(loc)}">
    </div>

    <div class="form-group">
      <label class="form-label">周数规则</label>
      <div class="week-type-options">
        <label class="radio-label">
          <input type="radio" name="${radioGroupName}" value="ALL" ${weekType === 'ALL' ? 'checked' : ''}> 所有周
        </label>
        <label class="radio-label">
          <input type="radio" name="${radioGroupName}" value="RANGE" ${weekType === 'RANGE' ? 'checked' : ''}> 连续范围
        </label>
        <label class="radio-label">
          <input type="radio" name="${radioGroupName}" value="CUSTOM" ${weekType === 'CUSTOM' ? 'checked' : ''}> 自定义周
        </label>
      </div>
    </div>

    <div class="session-range-fields form-row" style="display: ${weekType === 'RANGE' ? 'flex' : 'none'};">
      <div class="form-group">
        <label class="form-label">起始周</label>
        <input type="number" class="form-control session-start-week" min="1" max="${targetTotalWeeks}" value="${startW}">
      </div>
      <div class="form-group">
        <label class="form-label">结束周</label>
        <input type="number" class="form-control session-end-week" min="1" max="${targetTotalWeeks}" value="${endW}">
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
        ${Array.from({ length: targetTotalWeeks }, (_, i) => i + 1).map(w => `
          <button type="button" class="week-num-btn ${customW.includes(w) ? 'active' : ''}" data-week="${w}">${w}</button>
        `).join('')}
      </div>
    </div>
  `;

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
  card.querySelectorAll(`input[name="${radioGroupName}"]`).forEach(radio => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      card.querySelector('.session-range-fields').style.display = (val === 'RANGE') ? 'flex' : 'none';
      card.querySelector('.custom-weeks-selector').style.display = (val === 'CUSTOM') ? 'block' : 'none';
    });
  });

  // Custom week toggles
  const customGrid = card.querySelector('.custom-weeks-grid');
  const weekBtns = customGrid.querySelectorAll('.week-num-btn');
  weekBtns.forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // Quick select buttons
  const quickSelectors = [
    ['.btn-custom-all', () => true],
    ['.btn-custom-odd', w => w % 2 === 1],
    ['.btn-custom-even', w => w % 2 === 0],
    ['.btn-custom-clear', () => false]
  ];
  for (const [sel, predicate] of quickSelectors) {
    card.querySelector(sel).addEventListener('click', () => {
      weekBtns.forEach(b => b.classList.toggle('active', predicate(parseInt(b.dataset.week, 10))));
    });
  }

  // Delete button
  card.querySelector('.btn-del-session').addEventListener('click', () => {
    card.remove();
    reindexChildren('sessions-editor-container', '.session-title-num', n => `时间段 ${n}`);
  });

  container.appendChild(card);
}

async function commitCourseSave(courseData, sessionsData, toastMsg) {
  await saveCourseWithSessions(courseData, sessionsData);
  const targetTimetableId = courseData.timetableId;
  hideModal('course-editor-modal');
  await refreshAll();
  if (document.getElementById('course-list-modal').classList.contains('visible')) {
    openCourseListModal(targetTimetableId);
  }
  showFluidCloudToast('保存成功', toastMsg);
}

async function saveCourseForm() {
  const name = document.getElementById('course-form-name').value.trim();
  const teacher = document.getElementById('course-form-teacher').value.trim();
  const note = document.getElementById('course-form-note').value.trim();
  const colorHex = document.getElementById('course-custom-color').value || DEFAULT_COURSE_COLOR_HEX;
  const colorInt = hexToIntColor(colorHex);

  if (!name) return alert('请输入课程名称');

  const container = document.getElementById('sessions-editor-container');
  const cards = Array.from(container.children);
  if (cards.length === 0) return alert('请至少添加一个上课时间段');

  const targetTotalWeeks = state.editingCourseTotalWeeks || state.totalWeeks;
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
      endWeek = parseInt(card.querySelector('.session-end-week').value, 10) || targetTotalWeeks;
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
  const courseData = {
    id: state.editingCourseId,
    timetableId,
    name,
    teacher,
    color: colorInt,
    note
  };

  // Conflict Detection against the target timetable's totalWeeks
  const existingCourses = await getCoursesWithSessions(timetableId);
  const conflicts = checkCourseConflicts(existingCourses, sessions, targetTotalWeeks, state.editingCourseId);

  if (conflicts.length > 0) {
    state.pendingForceSaveCourse = { courseData, sessionsData: sessions };

    const conflictListEl = document.getElementById('conflict-list-content');
    conflictListEl.innerHTML = conflicts.map(c => `
      <div class="conflict-item-card">
        ⚠️ 与 <strong>${escapeHtml(c.existingCourseName)}</strong> 冲突：<br>
        ${DAY_NAMES[c.dayOfWeek - 1]} 第${c.overlapStartPeriod}-${c.overlapEndPeriod}节 · 第 ${c.overlapWeeks.join(',')} 周
      </div>
    `).join('');

    showModal('conflict-dialog-overlay');
    return;
  }

  await commitCourseSave(courseData, sessions, `课程“${name}”已保存`);
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
  const cellHeight = settings.courseCellHeightDp || DEFAULT_CELL_HEIGHT;
  const slider = document.getElementById('setting-cell-height-slider');
  slider.value = cellHeight;
  document.getElementById('setting-cell-height-label').textContent = `${cellHeight} px`;

  // Show non-current
  document.getElementById('setting-show-noncurrent-switch').checked = settings.showNonCurrentWeekCourses ?? true;

  renderWidgetPreviews();
  showModal('settings-modal');
}

async function saveSetting(patch) {
  state.settings = await updateSettings(patch);
}

function bindSettingsEvents() {
  // Notification toggle
  document.getElementById('setting-notify-switch').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      await requestNotificationPermission();
    }
    await saveSetting({ notificationsEnabled: enabled });
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
      await saveSetting({ reminderMinutes: min });
    });
  });

  // Theme mode radios
  document.querySelectorAll('input[name="themeModeRadio"]').forEach(r => {
    r.addEventListener('change', async (e) => {
      const mode = e.target.value;
      await saveSetting({ themeMode: mode });
      applyTheme(mode);
    });
  });

  // Cell height slider (pure CSS variable update on input, DB persistence on change)
  const slider = document.getElementById('setting-cell-height-slider');
  slider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('setting-cell-height-label').textContent = `${val} px`;
    state.settings.courseCellHeightDp = val;
    document.documentElement.style.setProperty('--cell-height', `${val}px`);
  });
  slider.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    await saveSetting({ courseCellHeightDp: val });
  });

  // Non-current switch
  document.getElementById('setting-show-noncurrent-switch').addEventListener('change', async (e) => {
    const checked = e.target.checked;
    await saveSetting({ showNonCurrentWeekCourses: checked });
    renderWeekGrid();
  });

  // Backup & Restore
  document.getElementById('btn-export-backup-json').addEventListener('click', async () => {
    const jsonStr = await exportFullBackupJSON();
    const dateStr = formatLocalDate().replace(/-/g, '');
    downloadFile(`sleepin_backup_${dateStr}.json`, 'application/json', jsonStr);
    showFluidCloudToast('导出成功', '已生成完整数据备份文件');
  });

  document.getElementById('btn-import-backup-json').addEventListener('click', () => {
    document.getElementById('input-file-backup-json').click();
  });

  document.getElementById('input-file-backup-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const jsonText = await file.text();
      await importFullBackupJSON(jsonText);
      alert('数据恢复成功！正在重新载入...');
      location.reload();
    } catch (err) {
      alert(`导入备份失败: ${err.message}`);
    }
  });

  // Check update (checks Service Worker registration update if available)
  document.getElementById('btn-check-update').addEventListener('click', async () => {
    const btn = document.getElementById('btn-check-update');
    btn.textContent = '检查中...';
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      }
    } catch (e) {}
    setTimeout(() => {
      btn.textContent = '检查更新';
      alert(`已是最新版本 (${APP_VERSION} Web Edition)`);
    }, 500);
  });
}

function renderWidgetPreviews() {
  const container = document.getElementById('widget-preview-box');
  if (!container || !state.activeTimetable) return;

  const dayOfWeek = getIsoDayOfWeek(new Date());
  const previewWeek = state.currentWeek || 1;

  // Find today's courses
  const todaySessions = [];
  state.courses.forEach(({ course, sessions }) => {
    sessions.forEach(sess => {
      if (sess.dayOfWeek === dayOfWeek && isSessionInWeek(sess, previewWeek, state.totalWeeks)) {
        todaySessions.push({ course, session: sess });
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
      ${todaySessions.length === 0 ? '<div class="widget-empty-hint">今天没有排课，好好休息吧~</div>' : ''}
      ${todaySessions.slice(0, 3).map(ts => `
        <div class="widget-item-pill">
          <span>${escapeHtml(ts.course.name)}</span>
          <span>第${ts.session.startPeriod}-${ts.session.endPeriod}节 ${ts.session.location ? '@' + escapeHtml(ts.session.location) : ''}</span>
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
