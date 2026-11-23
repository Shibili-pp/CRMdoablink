const cron = require('node-cron');
const { User } = require('../models');
const { processReminders } = require('../services/followups');
const { scan } = require('../services/alerts');
const { generateForStaff } = require('../services/hourly');
const { getGeneral } = require('../services/settings');
const { syncAllEnabled } = require('../services/sheets');
const { autoAssignSheetLeads } = require('../services/autoAssign');
const { applyWeekendAutoAssignRule } = require('../services/assignAllow');
const { processRnpReminders, moveRnpToBucketAfterWork } = require('../services/rnp');
const { moveUtcToBucketAfterWork } = require('../services/utc');
const { moveStaleUntouchedToBucket } = require('../services/freshAging');
const { zonedParts, dateKeyFromDate, addCalendarDays } = require('../utils/time');

function startJobs() {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_JOBS === 'true') return;
  // Sunday force OFF / Monday restore ON for auto-assign master switch (Asia/Kolkata).
  cron.schedule('2 * * * *', async () => {
    try {
      const master = await applyWeekendAutoAssignRule();
      if (master.sundayOff && master.resumeMonday) {
        console.log('Auto-assign: Sunday off · will resume Monday');
      } else if (master.weekday === 1 && master.enabled && master.mondayRestoredAt) {
        /* restored earlier in apply */ 
      }
    } catch (error) {
      console.error('Auto-assign weekend rule failed:', error.message);
    }
  });
  cron.schedule('*/5 * * * *', async () => {
    try {
      await processReminders();
      await scan();
      const rnp = await processRnpReminders();
      if (rnp.notified) console.log(`RNP reminders: ${rnp.notified}`);
      // Bucket moves only while Auto assigning is ON (checked inside each mover).
      const moved = await moveRnpToBucketAfterWork();
      if (moved.moved) console.log(`RNP to bucket: ${moved.moved}`);
      else if (moved.blocked) { /* auto-assign off — staff keep leads */ }
      const utcMoved = await moveUtcToBucketAfterWork();
      if (utcMoved.moved) console.log(`UTC to bucket: ${utcMoved.moved}`);
      const staleUntouched = await moveStaleUntouchedToBucket();
      if (staleUntouched.moved) {
        console.log(`Untouched/Fresh/Not Contacted → bucket (3 working days): ${staleUntouched.moved}`);
      }
    } catch (error) {
      console.error('Reminder job failed:', error.message);
    }
  });
  cron.schedule('*/3 * * * *', async () => {
    try {
      await syncAllEnabled();
    } catch (error) {
      console.error('Google Sheet sync failed:', error.message);
    }
  });
  cron.schedule('*/2 * * * *', async () => {
    try {
      // After Owner/SA allow today: only continuous sheet leads to present staff (no re-permission).
      const sheet = await autoAssignSheetLeads({ requireAllow: true });
      if (sheet.assigned) console.log(`Continuous sheet assign: ${sheet.assigned}`);
      else if (sheet.blocked) { /* awaiting allow */ }
    } catch (error) {
      console.error('Auto-assign job failed:', error.message);
    }
  });
  cron.schedule('5 * * * *', async () => {
    try {
      const general = await getGeneral();
      const now = new Date();
      const parts = zonedParts(now, general.timezone);
      let hour = parts.hour - 1;
      let dateKey = dateKeyFromDate(now, general.timezone);
      if (hour < 0) {
        hour = 23;
        const previous = addCalendarDays(parts.year, parts.month, parts.day, -1);
        dateKey = `${previous.year}-${String(previous.month).padStart(2, '0')}-${String(previous.day).padStart(2, '0')}`;
      }
      const people = await User.find({ deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] } });
      for (const person of people) {
        await generateForStaff(person, dateKey, hour, general.timezone);
      }
    } catch (error) {
      console.error('Hourly report job failed:', error.message);
    }
  });
}

module.exports = { startJobs };
