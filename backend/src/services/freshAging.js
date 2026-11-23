const { Lead, LeadAssignment, LeadActivity } = require('../models');
const { getGeneral } = require('./settings');
const { addActivity } = require('./activity');
const {
  zonedParts, dateKeyFromDate, dayBounds, addCalendarDays, weekdayIndex, wallTimeToUtc,
} = require('../utils/time');

/** Fresh / Not Contacted / Untouched — same hold rule. */
const UNTOUCHED_STATUSES = ['fresh', 'not_contacted'];
const UNTOUCHED_HOLD_WORKING_DAYS = 3;
const STATUS_TOUCH_TYPES = ['status_changed', 'demo_completed', 'onboarding_completed'];

/**
 * Start of the calendar day after `workingDays` working days have been counted
 * from `fromDate` (assignment day counts as day 1 if it is not Sunday).
 * Sunday is not a working day.
 */
function deadlineAfterWorkingDays(fromDate, workingDays, timeZone) {
  let parts = zonedParts(new Date(fromDate), timeZone);
  let counted = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    const noon = wallTimeToUtc(parts.year, parts.month, parts.day, 12, 0, 0, timeZone);
    const wd = weekdayIndex(noon, timeZone);
    if (wd !== 0) {
      counted += 1;
      if (counted >= workingDays) {
        const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
        return wallTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
      }
    }
    parts = addCalendarDays(parts.year, parts.month, parts.day, 1);
  }
  return new Date();
}

/** Leads assigned before this instant have completed the 3 working-day hold. */
function assignmentCutoff(now, timeZone, holdDays = UNTOUCHED_HOLD_WORKING_DAYS) {
  // Walk backward from yesterday to find a start-of-day cutoff spanning holdDays working days.
  let parts = zonedParts(now, timeZone);
  parts = addCalendarDays(parts.year, parts.month, parts.day, -1);
  let counted = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    const noon = wallTimeToUtc(parts.year, parts.month, parts.day, 12, 0, 0, timeZone);
    const wd = weekdayIndex(noon, timeZone);
    if (wd !== 0) {
      counted += 1;
      if (counted >= holdDays) {
        const { start } = dayBounds(
          `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
          timeZone,
        );
        return start;
      }
    }
    parts = addCalendarDays(parts.year, parts.month, parts.day, -1);
  }
  return dayBounds(dateKeyFromDate(now, timeZone), timeZone).start;
}

function isRealTouch(activity) {
  if (activity.type === 'demo_completed' || activity.type === 'onboarding_completed') return true;
  if (activity.type !== 'status_changed' && activity.type !== 'lead_status_changed') return false;
  const from = String(activity.oldValue || '');
  const to = String(activity.newValue || '');
  // Fresh ↔ Not Contacted are the same untouched concept — not a real touch.
  if (UNTOUCHED_STATUSES.includes(from) && UNTOUCHED_STATUSES.includes(to)) return false;
  return true;
}

async function stillUntouchedByAssignee(lead) {
  const since = new Date(lead.assignmentDate || lead.createdAt || 0).getTime();
  const activities = await LeadActivity.find({
    lead: lead._id,
    type: { $in: STATUS_TOUCH_TYPES },
    actor: lead.assignedTo,
    at: { $gte: new Date(since) },
  }).select('type oldValue newValue').lean();
  return !activities.some(isRealTouch);
}

/**
 * Fresh / Not Contacted stay with staff for 3 working days (Sun off).
 * If still untouched → park in bucket Untouched calls (not UTC).
 */
async function moveStaleUntouchedToBucket() {
  const assignAllow = require('./assignAllow');
  if (await assignAllow.isHoldAssignedOn()) {
    return {
      moved: 0,
      holdWorkingDays: UNTOUCHED_HOLD_WORKING_DAYS,
      blocked: true,
      reason: 'hold_assigned_on',
    };
  }
  if (!(await assignAllow.isAutoAssignOn())) {
    return {
      moved: 0,
      holdWorkingDays: UNTOUCHED_HOLD_WORKING_DAYS,
      blocked: true,
      reason: 'auto_assign_off',
    };
  }
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const cutoff = assignmentCutoff(now, timeZone, UNTOUCHED_HOLD_WORKING_DAYS);

  const leads = await Lead.find({
    deletedAt: null,
    status: { $in: UNTOUCHED_STATUSES },
    assignedTo: { $ne: null },
    assignmentDate: { $ne: null, $lt: cutoff },
    $or: [
      { untouchedParkedAt: null },
      { untouchedParkedAt: { $exists: false } },
    ],
  }).limit(400);

  if (!leads.length) {
    return {
      moved: 0,
      holdWorkingDays: UNTOUCHED_HOLD_WORKING_DAYS,
      cutoff: cutoff.toISOString(),
    };
  }

  let moved = 0;
  let skippedTouched = 0;
  for (const lead of leads) {
    if (!(await stillUntouchedByAssignee(lead))) {
      skippedTouched += 1;
      continue;
    }
    // Exact check: 3 working days from this lead's assignment must be complete.
    const deadline = deadlineAfterWorkingDays(lead.assignmentDate, UNTOUCHED_HOLD_WORKING_DAYS, timeZone);
    if (now < deadline) continue;

    const fromStaff = lead.assignedTo;
    lead.assignedTo = null;
    lead.team = null;
    lead.bucketStatus = 'unassigned';
    lead.assignmentDate = null;
    lead.untouchedParkedAt = now;
    await lead.save();

    await LeadAssignment.create({
      lead: lead._id,
      fromStaff,
      toStaff: null,
      assignedBy: null,
      reason: `Untouched / Fresh / Not Contacted held ${UNTOUCHED_HOLD_WORKING_DAYS} working days — moved to Untouched calls bucket`,
      mode: 'manual',
    });
    await addActivity({
      lead,
      type: 'lead_reassigned',
      actor: null,
      description: `Still untouched after ${UNTOUCHED_HOLD_WORKING_DAYS} working days → Untouched calls bucket`,
      oldValue: { status: lead.status, assignedTo: fromStaff },
      newValue: { status: lead.status, assignedTo: null },
      metadata: {
        reason: 'untouched_park_bucket',
        holdWorkingDays: UNTOUCHED_HOLD_WORKING_DAYS,
      },
    });
    moved += 1;
  }

  return {
    moved,
    skippedTouched,
    holdWorkingDays: UNTOUCHED_HOLD_WORKING_DAYS,
    cutoff: cutoff.toISOString(),
    dateKey: dateKeyFromDate(now, timeZone),
  };
}

/** @deprecated Use moveStaleUntouchedToBucket — Fresh no longer goes to UTC. */
async function moveStaleFreshToUtcBucket() {
  return moveStaleUntouchedToBucket();
}

module.exports = {
  FRESH_HOLD_DAYS: UNTOUCHED_HOLD_WORKING_DAYS,
  UNTOUCHED_HOLD_WORKING_DAYS,
  UNTOUCHED_STATUSES,
  assignmentCutoff,
  deadlineAfterWorkingDays,
  moveStaleUntouchedToBucket,
  moveStaleFreshToUtcBucket,
};
