const cron = require('node-cron');
const { User } = require('../models');
const { processReminders } = require('../services/followups');
const { scan } = require('../services/alerts');
const { generateForStaff } = require('../services/hourly');
const { getGeneral } = require('../services/settings');
const { zonedParts, dateKeyFromDate, addCalendarDays } = require('../utils/time');

function startJobs() {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_JOBS === 'true') return;
  cron.schedule('*/5 * * * *', async () => {
    try {
      await processReminders();
      await scan();
    } catch (error) {
      console.error('Reminder job failed:', error.message);
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
