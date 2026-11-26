/**
 * Timelines: named divisions of time into epochs, shared by the models that
 * are piecewise in time (epoch clocks, birth-death-sampling models).
 *
 * Time is measured as height, in years before the most recent sample. With N
 * transitions there are N + 1 epochs; epoch 1 is the most recent and the last
 * epoch runs back without end.
 */

import { parseDate } from './data';

export type TimeUnit = 'days' | 'weeks' | 'months' | 'years';

export const TIME_UNITS: Record<TimeUnit, { label: string; years: number }> = {
  days: { label: 'days', years: 1 / 365.25 },
  weeks: { label: 'weeks', years: 7 / 365.25 },
  months: { label: 'months', years: 1 / 12 },
  years: { label: 'years', years: 1 },
};

export type TimelineKind = 'regular' | 'dates' | 'heights';

export interface Timeline {
  id: string;
  name: string;
  /**
   * regular: `epochCount` epochs of the same `duration`, counted back from the most recent sample;
   * dates: transitions at the calendar dates in `dates` (needs dated tips);
   * heights: transitions at the times in `heights`, in years before the most recent sample.
   */
  kind: TimelineKind;
  epochCount?: number;
  duration?: number;
  units?: TimeUnit;
  /** yyyy-MM-dd or decimal years. */
  dates?: string[];
  heights?: number[];
}

export interface ResolvedTimeline {
  id: string;
  name: string;
  /** Transition times in years before the most recent sample, in increasing order. */
  heights: number[];
  /** A label for each transition, in the same order. */
  transitions: string[];
  /** A label for each epoch, most recent first; one more than the transitions. */
  epochs: string[];
}

export interface TimelineResolution {
  timeline?: ResolvedTimeline;
  /** Reasons the timeline cannot be used; empty when `timeline` is present. */
  problems: string[];
}

function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

/**
 * Work out a timeline's transition times. `mostRecent` is the date of the most
 * recent sample in decimal years, or undefined when the tips are not dated.
 */
export function resolveTimeline(timeline: Timeline, mostRecent: number | undefined): TimelineResolution {
  const problems: string[] = [];
  let points: { height: number; label?: string }[] = [];

  if (timeline.kind === 'regular') {
    const count = timeline.epochCount;
    const duration = timeline.duration;
    const unit = TIME_UNITS[timeline.units ?? 'years'];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 2) {
      problems.push('the number of epochs must be a whole number, 2 or more');
    } else if (count > 1000) {
      problems.push('the number of epochs must be at most 1000');
    }
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      problems.push('the duration of an epoch must be greater than 0');
    }
    if (!unit) problems.push(`unknown unit of time "${String(timeline.units)}"`);
    if (problems.length === 0) {
      for (let i = 1; i < (count as number); i++) points.push({ height: tidy(i * (duration as number) * unit.years) });
    }
  } else if (timeline.kind === 'dates') {
    const dates = timeline.dates ?? [];
    if (mostRecent === undefined) {
      problems.push('transitions given as dates need the tips to be dated');
    } else if (dates.length === 0) {
      problems.push('add at least one transition date');
    } else {
      for (const text of dates) {
        const parsed = /^\d{4}-\d{1,2}$/.test(text.trim()) ? null : parseDate(text);
        if (!parsed) {
          problems.push(`"${text}" is not a date (use yyyy-MM-dd or a decimal year)`);
          continue;
        }
        const height = tidy(mostRecent - parsed.value);
        if (height <= 0) problems.push(`${text.trim()} is not before the most recent sample`);
        else points.push({ height, label: text.trim() });
      }
    }
  } else if (timeline.kind === 'heights') {
    const heights = timeline.heights ?? [];
    if (heights.length === 0) problems.push('add at least one transition time');
    for (const height of heights) {
      if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
        problems.push('transition times must be greater than 0');
        break;
      }
      points.push({ height });
    }
  } else {
    problems.push(`unknown kind of timeline "${String((timeline as Timeline).kind)}"`);
  }

  points = points.sort((a, b) => a.height - b.height);
  if (points.some((p, i) => i > 0 && p.height === points[i - 1].height)) {
    problems.push('two transitions are at the same time');
  }
  if (problems.length > 0) return { problems };

  const transitions = points.map(
    (p) => p.label ?? (mostRecent === undefined ? `${p.height} years ago` : String(tidy(Number((mostRecent - p.height).toFixed(4))))),
  );
  const epochs = transitions.map((label, i) => (i === 0 ? `after ${label}` : `${label} to ${transitions[i - 1]}`));
  epochs.push(`before ${transitions[transitions.length - 1]}`);
  return {
    timeline: { id: timeline.id, name: timeline.name, heights: points.map((p) => p.height), transitions, epochs },
    problems: [],
  };
}

/** A new timeline with sensible starting values and an unused id and name. */
export function newTimeline(existing: Timeline[], kind: TimelineKind = 'regular'): Timeline {
  let n = 1;
  while (existing.some((t) => t.id === `timeline-${n}` || t.name === `timeline${n}`)) n++;
  return { id: `timeline-${n}`, name: `timeline${n}`, kind, epochCount: 4, duration: 1, units: 'years', dates: [], heights: [] };
}
