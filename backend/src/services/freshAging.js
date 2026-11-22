const { Lead, LeadAssignment } = require('../models');
const { getGeneral } = require('./settings');
const { addActivity } = require('./activity');
const { zonedParts, dateKeyFromDate, dayBounds, addCalendarDays } = require('../utils/time');

const FRESH_HOLD_DAYS = 2;

/**
 * Fresh leads stay with staff for 2 calendar days (Calls today).
 * If still fresh after that → move to bucket as UTC for automatic reassign.
 * (RNP/UTC status changes still follow same-day hold → after-work bucket → next-day rotate.)
 */
function assignmentCutoff(now, timeZone, holdDays = FRESH_HOLD_DAYS) {
  const parts = zonedParts(now, timeZone);
  const cutoffDay = addCalendarDays(parts.year, parts.month, parts.day, -(holdDays));
  const key = `${cutoffDay.year}-${String(cutoffDay.month).padStart(2, '0')}-${String(cutoffDay.day).padStart(2, '0')}`;
  const { end } = dayBounds(key, timeZone);
  // assignmentDate strictly before start of (today - holdDays + 1) ≡ on or before today-holdDays
  // Using end of cutoff day: assigned on Mon, holdDays=2, on Wed cutoff end-of-Mon → assigned Mon is < end of Mon? 
  // Better: assignedAt < start of (today - (holdDays - 1))? 
  // Assigned Monday, today Wednesday: days apart = 2 → move.
  // cutoff = start of (today - 1) = start of Tuesday → Monday assignment < Tuesday start → move. Good.
  // Assigned Tuesday, today Wednesday: Tuesday >= Tuesday start → keep.
  const keepFrom = addCalendarDays(parts.year, parts.month, parts.day, -(holdDays - 1));
  const keepKey = `${keepFrom.year}-${String(keepFrom.month).padStart(2, '0')}-${String(keepFrom.day).padStart(2, '0')}`;
  const { start } = dayBounds(keepKey, timeZone);
  return start;
}

async function moveStaleFreshToUtcBucket() {
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const cutoff = assignmentCutoff(now, timeZone, FRESH_HOLD_DAYS);

  const leads = await Lead.find({
    deletedAt: null,
    status: 'fresh',
    assignedTo: { $ne: null },
    assignmentDate: { $ne: null, $lt: cutoff },
  }).limit(400);

  if (!leads.length) return { moved: 0, holdDays: FRESH_HOLD_DAYS, cutoff: cutoff.toISOString() };

  let moved = 0;
  for (const lead of leads) {
    const fromStaff = lead.assignedTo;
    lead.utcLastStaff = fromStaff;
    lead.status = 'utc';
    lead.statusChangedAt = now;
    lead.assignedTo = null;
    lead.team = null;
    lead.bucketStatus = 'unassigned';
    lead.assignmentDate = null;
    await lead.save();

    await LeadAssignment.create({
      lead: lead._id,
      fromStaff,
      toStaff: null,
      assignedBy: null,
      reason: `Fresh held ${FRESH_HOLD_DAYS} days with no RNP/UTC — moved to UTC bucket for reassign`,
      mode: 'manual',
    });
    await addActivity({
      lead,
      type: 'lead_status_changed',
      actor: null,
      description: `Fresh after ${FRESH_HOLD_DAYS} days → UTC bucket for automatic reassign`,
      oldValue: { status: 'fresh', assignedTo: fromStaff },
      newValue: { status: 'utc', assignedTo: null },
      metadata: { reason: 'fresh_aged_utc_bucket', holdDays: FRESH_HOLD_DAYS },
    });
    moved += 1;
  }

  return {
    moved,
    holdDays: FRESH_HOLD_DAYS,
    cutoff: cutoff.toISOString(),
    dateKey: dateKeyFromDate(now, timeZone),
  };
}

module.exports = {
  FRESH_HOLD_DAYS,
  assignmentCutoff,
  moveStaleFreshToUtcBucket,
};
