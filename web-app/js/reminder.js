/**
 * Class Reminder & Audio Chime Service for SleepIn Web.
 * Supports Web Audio API synthesis, Audio element playback, Notification API,
 * and In-App Dynamic Island / Fluid Cloud Toast.
 */

import { getSettings, getActiveTimetable, getPeriodsBySchedule, getCoursesWithSessions, formatLocalDate } from './db.js';
import { resolveWeeks } from './conflict.js';

let audioContext = null;
let reminderAudio = null;
let lastCheckedDateStr = '';
const notifiedSessionsToday = new Set(); // Key: `${dateStr}_${courseId}_${sessionId}`

export function initAudio() {
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

export function playSynthesizedChime() {
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

    // Tone 1: C6 (1046.5Hz)
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.35, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.start(now);
    osc1.stop(now + 0.9);

    // Tone 2: E6 (1318.5Hz)
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.5, now + 0.22);
    gain2.gain.setValueAtTime(0, now + 0.22);
    gain2.gain.linearRampToValueAtTime(0.4, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.start(now + 0.22);
    osc2.stop(now + 1.4);
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
 */
export async function checkReminders() {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;

  const activeTimetable = await getActiveTimetable();
  if (!activeTimetable) return;

  const now = new Date();
  const todayStr = formatLocalDate(now);

  if (todayStr !== lastCheckedDateStr) {
    notifiedSessionsToday.clear();
    lastCheckedDateStr = todayStr;
  }

  // Calculate current semester week
  const startDate = new Date(activeTimetable.startDate + 'T00:00:00');
  const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  if (daysDiff < 0) return; // Semester not started
  const currentWeek = Math.floor(daysDiff / 7) + 1;
  if (currentWeek > activeTimetable.totalWeeks) return; // Semester ended

  // Day of week: 1 = Monday, 7 = Sunday
  const jsDay = now.getDay();
  const dayOfWeek = (jsDay === 0 ? 7 : jsDay);

  const periods = await getPeriodsBySchedule(activeTimetable.scheduleId);
  const periodMap = {};
  periods.forEach(p => { periodMap[p.periodNumber] = p; });

  const coursesWithSessions = await getCoursesWithSessions(activeTimetable.id);
  const reminderMinutes = settings.reminderMinutes || 10;

  for (const item of coursesWithSessions) {
    const { course, sessions } = item;
    for (const sess of sessions) {
      if (Number(sess.dayOfWeek) !== dayOfWeek) continue;

      const activeWeeks = resolveWeeks(sess.weekType, sess.startWeek, sess.endWeek, sess.customWeeks, activeTimetable.totalWeeks);
      if (!activeWeeks.has(currentWeek)) continue;

      const firstPeriod = periodMap[sess.startPeriod];
      if (!firstPeriod) continue;

      // Class start time today
      const [h, m] = firstPeriod.startTime.split(':').map(Number);
      const classStartTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);

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
        showFluidCloudToast(title, body);
      }
    }
  }
}

// Start recurring check
export function startReminderScheduler() {
  initAudio();
  setInterval(() => {
    checkReminders().catch(() => {});
  }, 15000);
  checkReminders().catch(() => {});
}
