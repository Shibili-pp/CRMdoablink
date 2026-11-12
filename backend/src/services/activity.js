const { LeadActivity, Lead, CustomLeadStatus } = require('../models');

async function addActivity({ lead, type, actor, description, oldValue, newValue, metadata, session }) {
  const leadId = lead._id || lead;
  const doc = {
    lead: leadId,
    type,
    actor: actor?._id,
    actorName: actor?.name || 'System',
    description,
    oldValue,
    newValue,
    metadata,
    at: new Date(),
  };
  if (session) await LeadActivity.create([doc], { session });
  else await LeadActivity.create(doc);
  const options = session ? { session } : {};
  await Lead.updateOne({ _id: leadId }, { lastActivityAt: new Date() }, options);
  return doc;
}

async function statusLabel(key) {
  const row = await CustomLeadStatus.findOne({ key }).lean();
  return row?.label || key;
}

module.exports = { addActivity, statusLabel };
