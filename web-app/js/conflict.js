/**
 * Conflict detection for SleepIn courses.
 * Faithfully mirrors CheckConflictUseCase.kt.
 */

export function resolveWeeks(weekType, startWeek, endWeek, customWeeks, totalWeeks) {
  const weeks = new Set();
  const safeTotal = Math.max(1, totalWeeks);

  if (weekType === 'ALL') {
    for (let w = 1; w <= safeTotal; w++) weeks.add(w);
  } else if (weekType === 'RANGE') {
    const s = Math.max(1, startWeek || 1);
    const e = Math.min(safeTotal, endWeek || safeTotal);
    for (let w = s; w <= e; w++) weeks.add(w);
  } else if (weekType === 'CUSTOM') {
    (customWeeks || []).forEach(w => {
      if (w >= 1 && w <= safeTotal) weeks.add(w);
    });
  }
  return weeks;
}

export function checkCourseConflicts(existingCoursesWithSessions, candidateSessions, totalWeeks, editingCourseId = null) {
  const filteredExisting = existingCoursesWithSessions.filter(
    item => editingCourseId == null || item.course.id !== Number(editingCourseId)
  );

  const conflicts = [];

  for (const candidate of candidateSessions) {
    const candidateWeeks = resolveWeeks(
      candidate.weekType,
      candidate.startWeek,
      candidate.endWeek,
      candidate.customWeeks,
      totalWeeks
    );
    if (candidateWeeks.size === 0) continue;

    for (const item of filteredExisting) {
      const { course, sessions } = item;
      for (const exSession of sessions) {
        if (Number(candidate.dayOfWeek) !== Number(exSession.dayOfWeek)) continue;

        // Check period overlap
        const cStart = Number(candidate.startPeriod);
        const cEnd = Number(candidate.endPeriod);
        const exStart = Number(exSession.startPeriod);
        const exEnd = Number(exSession.endPeriod);

        const isPeriodOverlap = (cStart <= exEnd && exStart <= cEnd);
        if (!isPeriodOverlap) continue;

        const exWeeks = resolveWeeks(
          exSession.weekType,
          exSession.startWeek,
          exSession.endWeek,
          exSession.customWeeks,
          totalWeeks
        );

        const overlapWeeks = [];
        candidateWeeks.forEach(w => {
          if (exWeeks.has(w)) overlapWeeks.push(w);
        });
        overlapWeeks.sort((a, b) => a - b);

        if (overlapWeeks.length > 0) {
          conflicts.push({
            existingCourseId: course.id,
            existingCourseName: course.name,
            dayOfWeek: candidate.dayOfWeek,
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
