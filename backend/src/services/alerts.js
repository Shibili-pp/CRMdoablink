const { AlertRule, Lead, FollowUp, User, Payment, RevenueOpportunity } = require('../models');
const { notify, notifyMany } = require('./notify');
const { measureTarget } = require('./metrics');
const { periodRange } = require('../utils/time');
const { getGeneral } = require('./settings');
const { POSITIVE_STATUSES, WON_STATUSES, LOST_STATUSES } = require('../config/constants');
const { Target } = require('../models');

async function recipientsForLead(lead) {
  const ids = [];
  if (lead.assignedTo) ids.push(lead.assignedTo);
  const managers = await User.find({
    isActive: true,
    deletedAt: null,
    $or: [
      { role: { $in: ['OWNER', 'SUPER_ADMIN'] } },
      { role: 'ADMIN', branch: lead.branch },
      { role: 'TEAM_LEADER', team: lead.team },
    ],
  }).select('_id');
  managers.forEach((row) => ids.push(row._id));
  return ids;
}

async function scan() {
  const rules = await AlertRule.find({ enabled: true }).lean();
  const byKey = new Map(rules.map((rule) => [rule.key, rule]));
  const now = new Date();
  let created = 0;

  const freshRule = byKey.get('fresh_uncontacted');
  if (freshRule) {
    const cutoff = new Date(now.getTime() - freshRule.threshold * 60000);
    const leads = await Lead.find({
      deletedAt: null, status: { $in: ['fresh', 'not_contacted'] }, firstContactAt: null, createdAt: { $lte: cutoff },
    }).limit(200);
    for (const lead of leads) {
      await notifyMany(await recipientsForLead(lead), {
        type: 'lead_inactivity', title: 'Fresh lead not contacted',
        body: `${lead.leadCode} ${lead.name} has had no contact.`, module: 'leads', recordId: lead.id, dedupeKey: `fresh:${lead.id}`,
      });
      created += 1;
    }
  }

  const interested = byKey.get('interested_no_followup');
  if (interested) {
    const leads = await Lead.find({ deletedAt: null, status: 'interested', nextActionDueAt: null }).limit(200);
    for (const lead of leads) {
      const pending = await FollowUp.exists({ lead: lead._id, status: 'pending' });
      if (pending) continue;
      await notifyMany(await recipientsForLead(lead), {
        type: 'lead_inactivity', title: 'Interested lead needs a follow-up',
        body: `${lead.leadCode} ${lead.name}`, module: 'leads', recordId: lead.id, dedupeKey: `interested:${lead.id}`,
      });
      created += 1;
    }
  }

  const demoRule = byKey.get('demo_no_next_action');
  if (demoRule) {
    const cutoff = new Date(now.getTime() - demoRule.threshold * 3600000);
    const leads = await Lead.find({
      deletedAt: null, status: 'demo_completed', statusChangedAt: { $lte: cutoff },
      $or: [{ nextActionTitle: '' }, { nextActionTitle: null }, { nextActionTitle: { $exists: false } }],
    }).limit(200);
    for (const lead of leads) {
      await notifyMany(await recipientsForLead(lead), {
        type: 'lead_inactivity', title: 'Demo completed without a next action',
        body: `${lead.leadCode} ${lead.name}`, module: 'leads', recordId: lead.id, dedupeKey: `demo-next:${lead.id}`,
      });
      created += 1;
    }
  }

  const paymentRule = byKey.get('payment_pending');
  if (paymentRule) {
    const cutoff = new Date(now.getTime() - paymentRule.threshold * 3600000);
    const leads = await Lead.find({ deletedAt: null, status: 'payment_pending', statusChangedAt: { $lte: cutoff } }).limit(200);
    for (const lead of leads) {
      await notifyMany(await recipientsForLead(lead), {
        type: 'payment_pending', title: 'Payment still pending',
        body: `${lead.leadCode} has been pending since ${new Date(lead.statusChangedAt).toLocaleString()}`,
        module: 'leads', recordId: lead.id, dedupeKey: `payment:${lead.id}`,
      });
      created += 1;
    }
  }

  const idle = byKey.get('lead_inactivity');
  if (idle) {
    const cutoff = new Date(now.getTime() - idle.threshold * 86400000);
    const leads = await Lead.find({
      deletedAt: null,
      status: { $nin: [...WON_STATUSES, ...LOST_STATUSES] },
      lastActivityAt: { $lte: cutoff },
    }).limit(200);
    const day = now.toISOString().slice(0, 10);
    for (const lead of leads) {
      await notifyMany(await recipientsForLead(lead), {
        type: 'lead_inactivity', title: 'Lead has gone quiet',
        body: `${lead.leadCode} ${lead.name} has no recent activity.`, module: 'leads', recordId: lead.id, dedupeKey: `idle:${lead.id}:${day}`,
      });
      created += 1;
    }
  }

  const unworked = byKey.get('staff_unworked_leads');
  if (unworked) {
    const grouped = await Lead.aggregate([
      { $match: { deletedAt: null, assignedTo: { $ne: null }, status: { $in: ['fresh', 'not_contacted'] }, lastContactedAt: null } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      { $match: { count: { $gte: unworked.threshold } } },
    ]);
    for (const row of grouped) {
      const staff = await User.findById(row._id);
      if (!staff) continue;
      const day = now.toISOString().slice(0, 10);
      await notifyMany([staff._id, staff.manager], {
        type: 'staff_alert', title: 'Too many unworked leads',
        body: `${staff.name} has ${row.count} leads that have not been contacted.`, module: 'staff', recordId: staff.id,
        dedupeKey: `unworked:${staff.id}:${day}`,
      });
      created += 1;
    }
  }

  const below = byKey.get('staff_below_target');
  if (below) {
    const general = await getGeneral();
    const range = periodRange('day', general.timezone, now);
    const hour = now.getUTCHours();
    if (hour >= 8) {
      const targets = await Target.find({ isActive: true, type: 'daily_calls', assigneeType: 'staff' });
      const day = now.toISOString().slice(0, 10);
      for (const target of targets) {
        const actual = await measureTarget(target, range);
        const pct = target.value ? (actual / target.value) * 100 : 0;
        if (pct < below.threshold) {
          await notify({
            user: target.staff, type: 'target_warning', title: 'Daily call target is behind',
            body: `${actual} of ${target.value} calls so far today.`, module: 'targets', recordId: target.id,
            dedupeKey: `target:${target.staff}:${day}`,
          });
          created += 1;
        }
      }
    }
  }

  return { created };
}

async function listRules() {
  const rules = await AlertRule.find().sort({ key: 1 }).lean();
  return { data: rules };
}

module.exports = { scan, listRules };
