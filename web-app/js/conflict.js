/**
 * Conflict detection and week resolution utilities for SleepIn courses.
 * Faithfully mirrors CheckConflictUseCase.kt.
 */

export function resolveWeeks(sessionOrWeekType, startWeekOrTotal, endWeek, customWeeks, totalWeeks) {
  let weekType;
  let startWeek;
  let endW;
  let customW;
  let total;

  if (sessionOrWeekType && typeof sessionOrWeekType === 'object') {
    weekType = sessionOrWeekType.weekType;
    startWeek = sessionOrWeekType.startWeek;
    endW = sessionOrWeekType.endWeek;
    customW = sessionOrWeekType.customWeeks;
    total = startWeekOrTotal;
  } else {
    weekType = sessionOrWeekType;
    startWeek = startWeekOrTotal;
    endW = endWeek;
    customW = customWeeks;
    total = totalWeeks;
  }

  const weeks = new Set();
  const safeTotal = Math.max(1, Number(total) || 1);

  if (weekType === 'ALL') {
    for (let w = 1; w <= safeTotal; w++) weeks.add(w);
  } else if (weekType === 'RANGE') {
    const s = Math.max(1, startWeek || 1);
    const e = Math.min(safeTotal, endW || safeTotal);
    for (let w = s; w <= e; w++) weeks.add(w);
  } else if (weekType === 'CUSTOM') {
    (customW || []).forEach(w => {
      if (w >= 1 && w <= safeTotal) weeks.add(w);
    });
  }
  return weeks;
}

export function isSessionInWeek(session, week, totalWeeks) {
  return resolveWeeks(session, totalWeeks).has(week);
}

export function formatSessionWeeks(session, totalWeeks, mode = 'ui') {
  const isCsv = (mode === 'csv');
  if (session.weekType === 'RANGE') {
    const rangeStr = `${session.startWeek || 1}-${session.endWeek || totalWeeks}`;
    return isCsv ? rangeStr : `第 ${rangeStr} 周`;
  }
  if (session.weekType === 'CUSTOM') {
    const sorted = [...(session.customWeeks || [])].sort((a, b) => a - b);
    return isCsv ? sorted.join(';') : `第 ${sorted.join(',')} 周`;
  }
  return isCsv ? `1-${totalWeeks}` : '所有周';
}

export function checkCourseConflicts(existingCoursesWithSessions, candidateSessions, totalWeeks, editingCourseId = null) {
  const editingId = editingCourseId != null ? Number(editingCourseId) : null;
  const filteredExisting = existingCoursesWithSessions.filter(
    item => editingId == null || item.course.id !== editingId
  );

  const conflicts = [];

  for (const candidate of candidateSessions) {
    const candidateWeeks = resolveWeeks(candidate, totalWeeks);
    if (candidateWeeks.size === 0) continue;

    const cDay = Number(candidate.dayOfWeek);
    const cStart = Number(candidate.startPeriod);
    const cEnd = Number(candidate.endPeriod);

    for (const item of filteredExisting) {
      const { course, sessions } = item;
      for (const exSession of sessions) {
        if (cDay !== Number(exSession.dayOfWeek)) continue;

        const exStart = Number(exSession.startPeriod);
        const exEnd = Number(exSession.endPeriod);

        if (cStart > exEnd || exStart > cEnd) continue;

        const exWeeks = resolveWeeks(exSession, totalWeeks);
        const overlapWeeks = [];
        candidateWeeks.forEach(w => {
          if (exWeeks.has(w)) overlapWeeks.push(w);
        });
        overlapWeeks.sort((a, b) => a - b);

        if (overlapWeeks.length > 0) {
          conflicts.push({
            existingCourseId: course.id,
            existingCourseName: course.name,
            dayOfWeek: cDay,
            overlapStartPeriod: Math.max(cStart, exStart),
            overlapEndPeriod: Math.min(cEnd, exEnd),
            overlapWeeks
          });
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const c of conflicts) {
    const key = `${c.existingCourseId}_${c.dayOfWeek}_${c.overlapStartPeriod}_${c.overlapEndPeriod}_${c.overlapWeeks.join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }

  return deduped;
}
