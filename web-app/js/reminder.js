/**
 * Class Reminder & Audio Chime Service for SleepIn Web.
 * Supports Web Audio API synthesis, Audio element playback, Notification API,
 * and In-App Dynamic Island / Fluid Cloud Toast.
 */

import {
  getSettings,
  getActiveTimetable,
  getPeriodsBySchedule,
  getCoursesWithSessions,
  formatLocalDate,
  getIsoDayOfWeek,
  timeToMinutes,
  computeSemesterStatus
} from './db.js';
import { isSessionInWeek } from './conflict.js';

let audioContext = null;
let reminderAudio = null;
let lastCheckedDateStr = '';
const notifiedSessionsToday = new Set(); // Key: `${dateStr}_${courseId}_${sessionId}`

function initAudio() {
  try {
    reminderAudio = new Audio('./assets/audio/reminder.wav');
  } catch (e) {
    console.warn('Audio element init error:', e);
  }
}

/**
 * Plays the melodic 2-tone reminder chime.
 * Uses <audio> first, falling back to Web Audio API synthesized chime.
 */
export async function playReminderChime() {
  let played = false;
  if (reminderAudio) {
    try {
      reminderAudio.currentTime = 0;
      await reminderAudio.play();
      played = true;
    } catch (e) {
      // Audio autoplay policy might require user gesture, fallback to Web Audio
    }
  }

  if (!played) {
    playSynthesizedChime();
  }
}

function playSynthesizedChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext) {
      audioContext = new AudioCtx();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const now = audioContext.currentTime;
    const playTone = (freq, startOffset, attackOffset, stopOffset, peakGain) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0, now + startOffset);
      gain.gain.linearRampToValueAtTime(peakGain, now + attackOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + stopOffset);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + startOffset);
      osc.stop(now + stopOffset);
    };

    // Tone 1: C6 (1046.5Hz), Tone 2: E6 (1318.5Hz)
    playTone(1046.5, 0, 0.03, 0.9, 0.35);
    playTone(1318.5, 0.22, 0.25, 1.4, 0.4);
  } catch (e) {
    console.warn('Web Audio synthesis failed:', e);
  }
}

/**
 * Requests browser system notification permission.
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return await Notification.requestPermission();
}

/**
 * Displays in-app Dynamic Island / Fluid Cloud toast safely (XSS-safe).
 */
export function showFluidCloudToast(title, body, duration = 6000) {
  let container = document.getElementById('fluid-cloud-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'fluid-cloud-container';
    container.className = 'fluid-cloud-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'fluid-cloud-pill';

  const iconEl = document.createElement('div');
  iconEl.className = 'fluid-cloud-icon';
  iconEl.textContent = '🔔';

  const contentEl = document.createElement('div');
  contentEl.className = 'fluid-cloud-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'fluid-cloud-title';
  titleEl.textContent = title;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'fluid-cloud-body';
  bodyEl.textContent = body;

  contentEl.appendChild(titleEl);
  contentEl.appendChild(bodyEl);
  toast.appendChild(iconEl);
  toast.appendChild(contentEl);

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

/**
 * Checks for upcoming classes and triggers reminder when due.
 * Reuses in-memory appState when provided to avoid redundant IndexedDB queries.
 */
export async function checkReminders(appState = null) {
  const settings = (appState && appState.settings && Object.keys(appState.settings).length > 0)
    ? appState.settings
    : await getSettings();
  if (!settings.notificationsEnabled) return;

  const activeTimetable = (appState && appState.activeTimetable !== undefined)
    ? appState.activeTimetable
    : await getActiveTimetable();
  if (!activeTimetable) return;

  const now = new Date();
  const todayStr = formatLocalDate(now);

  if (todayStr !== lastCheckedDateStr) {
    notifiedSessionsToday.clear();
    lastCheckedDateStr = todayStr;
  }

  const { currentWeek, totalWeeks } = computeSemesterStatus(activeTimetable, now);
  if (!currentWeek) return; // Semester not started or already ended

  const dayOfWeek = getIsoDayOfWeek(now);

  const periods = (appState && Array.isArray(appState.periods))
    ? appState.periods
    : await getPeriodsBySchedule(activeTimetable.scheduleId);
  const periodMap = {};
  periods.forEach(p => { periodMap[p.periodNumber] = p; });

  const coursesWithSessions = (appState && Array.isArray(appState.courses))
    ? appState.courses
    : await getCoursesWithSessions(activeTimetable.id);
  const reminderMinutes = settings.reminderMinutes || 10;

  for (const item of coursesWithSessions) {
    const { course, sessions } = item;
    for (const sess of sessions) {
      if (Number(sess.dayOfWeek) !== dayOfWeek) continue;
      if (!isSessionInWeek(sess, currentWeek, totalWeeks)) continue;

      const firstPeriod = periodMap[sess.startPeriod];
      if (!firstPeriod) continue;

      // Class start time today
      const startMins = timeToMinutes(firstPeriod.startTime);
      const classStartTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        Math.floor(startMins / 60),
        startMins % 60,
        0
      );

      // Reminder trigger window: [classStartTime - reminderMinutes, classStartTime)
      const reminderTime = new Date(classStartTime.getTime() - reminderMinutes * 60 * 1000);
      const sessionKey = `${todayStr}_${course.id}_${sess.id || sess.startPeriod}`;

      if (now >= reminderTime && now < classStartTime && !notifiedSessionsToday.has(sessionKey)) {
        notifiedSessionsToday.add(sessionKey);

        const remainingMins = Math.max(1, Math.ceil((classStartTime - now) / (60 * 1000)));
        const title = `上课提醒：${course.name}`;
        const loc = sess.location ? ` @ ${sess.location}` : '';
        const body = `还有 ${remainingMins} 分钟上课 (${firstPeriod.startTime})${loc}`;

        // 1. Play chime audio
        playReminderChime();

        // 2. Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(title, {
              body,
              icon: './icons/icon-192.png',
              badge: './icons/favicon.png'
            });
          } catch (e) {}
        }

        // 3. In-app fluid cloud notification
        if (settings.fluidCloudEnabled !== false) {
          showFluidCloudToast(title, body);
        }
      }
    }
  }
}

// Start recurring check (also invokes optional onTick callback so app only needs 1 timer)
export function startReminderScheduler(getStateFn = null, onTick = null) {
  initAudio();
  const runTick = () => {
    const currentState = typeof getStateFn === 'function' ? getStateFn() : null;
    if (typeof onTick === 'function') {
      try { onTick(); } catch (e) {}
    }
    checkReminders(currentState).catch(() => {});
  };
  setInterval(runTick, 15000);
  runTick();
}
