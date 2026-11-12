const ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'STAFF'];

const ROLE_RANK = {
  OWNER: 5,
  SUPER_ADMIN: 4,
  ADMIN: 3,
  TEAM_LEADER: 2,
  STAFF: 1,
};

const LEAD_SOURCES = [
  'Meta Ads',
  'Google Ads',
  'Website',
  'Referral',
  'Walk-in',
  'Telecalling',
  'Campaign',
  'Manual Upload',
  'Device Contact',
  'Other',
];

const LEAD_STATUSES = [
  { key: 'fresh', label: 'Fresh', category: 'open', sortOrder: 10 },
  { key: 'not_contacted', label: 'Not Contacted', category: 'open', sortOrder: 20 },
  { key: 'contacted', label: 'Contacted', category: 'open', sortOrder: 30 },
  { key: 'connected', label: 'Connected', category: 'open', sortOrder: 40 },
  { key: 'interested', label: 'Interested', category: 'open', sortOrder: 50 },
  { key: 'positive', label: 'Positive', category: 'positive', sortOrder: 60 },
  { key: 'demo_booked', label: 'Demo Booked', category: 'positive', sortOrder: 70 },
  { key: 'demo_completed', label: 'Demo Completed', category: 'positive', sortOrder: 80 },
  { key: 'proposal_sent', label: 'Proposal Sent', category: 'positive', sortOrder: 90 },
  { key: 'payment_pending', label: 'Payment Pending', category: 'positive', sortOrder: 100 },
  { key: 'payment_received', label: 'Payment Received', category: 'won', sortOrder: 110 },
  { key: 'onboarding_pending', label: 'Onboarding Pending', category: 'won', sortOrder: 120 },
  { key: 'onboarded', label: 'Onboarded', category: 'won', sortOrder: 130 },
  { key: 'follow_up_required', label: 'Follow-up Required', category: 'open', sortOrder: 140 },
  { key: 'not_interested', label: 'Not Interested', category: 'lost', sortOrder: 150 },
  { key: 'disqualified', label: 'Disqualified', category: 'lost', sortOrder: 160 },
  { key: 'lost', label: 'Lost', category: 'lost', sortOrder: 170 },
];

const PIPELINE_STAGES = [
  { key: 'new', label: 'New', probability: 10, sortOrder: 10, isWon: false, isLost: false },
  { key: 'qualified', label: 'Qualified', probability: 25, sortOrder: 20, isWon: false, isLost: false },
  { key: 'demo', label: 'Demo', probability: 40, sortOrder: 30, isWon: false, isLost: false },
  { key: 'proposal', label: 'Proposal', probability: 60, sortOrder: 40, isWon: false, isLost: false },
  { key: 'negotiation', label: 'Negotiation', probability: 75, sortOrder: 50, isWon: false, isLost: false },
  { key: 'won', label: 'Won', probability: 100, sortOrder: 60, isWon: true, isLost: false },
  { key: 'lost', label: 'Lost', probability: 0, sortOrder: 70, isWon: false, isLost: true },
];

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const QUALITIES = ['cold', 'warm', 'hot'];

const TARGET_TYPES = [
  { key: 'daily_calls', label: 'Total calls', group: 'kpi', unit: 'calls', period: 'daily' },
  { key: 'daily_connected_calls', label: 'Connected calls', group: 'kpi', unit: 'calls', period: 'daily' },
  { key: 'daily_unique_calls', label: 'Unique numbers', group: 'kpi', unit: 'calls', period: 'daily' },
  { key: 'daily_followups', label: 'Follow-ups', group: 'kpi', unit: 'count', period: 'daily' },
  { key: 'call_duration', label: 'Total call duration', group: 'kpi', unit: 'minutes', period: 'daily' },
  { key: 'prospective', label: 'Prospective', group: 'kra', unit: 'count', period: 'monthly' },
  { key: 'demo_booked', label: 'Demo booked', group: 'kra', unit: 'count', period: 'weekly' },
  { key: 'demo_completed', label: 'Demo completed', group: 'kra', unit: 'count', period: 'weekly' },
  { key: 'interested_to_buy', label: 'Interested to buy', group: 'kra', unit: 'count', period: 'monthly' },
  { key: 'subscription_sales', label: 'Subscription closed', group: 'kra', unit: 'count', period: 'monthly' },
  { key: 'revenue_collection', label: 'Payment collected', group: 'kra', unit: 'money', period: 'monthly' },
  { key: 'conversion_rate', label: 'Conversion rate', group: 'kra', unit: 'percent', period: 'monthly' },
  { key: 'weekly_demos', label: 'Demo completed', group: 'kra', unit: 'count', period: 'weekly', legacy: true },
  { key: 'monthly_demos', label: 'Demo completed', group: 'kra', unit: 'count', period: 'monthly', legacy: true },
  { key: 'positive_leads', label: 'Prospective', group: 'kra', unit: 'count', period: 'monthly', legacy: true },
];

const WON_STATUSES = ['payment_received', 'onboarding_pending', 'onboarded'];
const POSITIVE_STATUSES = ['positive', 'demo_booked', 'demo_completed', 'proposal_sent', 'payment_pending', 'payment_received', 'onboarding_pending', 'onboarded'];
const CONNECTED_LEAD_STATUSES = ['connected', 'interested', 'positive', 'demo_booked', 'demo_completed', 'proposal_sent', 'payment_pending', 'payment_received', 'onboarding_pending', 'onboarded', 'follow_up_required'];
const LOST_STATUSES = ['not_interested', 'disqualified', 'lost'];

const ALERT_RULES = [
  { key: 'fresh_uncontacted', label: 'Fresh lead not contacted', threshold: 30, unit: 'minutes', enabled: true },
  { key: 'interested_no_followup', label: 'Interested lead without a follow-up', threshold: 24, unit: 'hours', enabled: true },
  { key: 'demo_no_next_action', label: 'Demo completed without a next action', threshold: 24, unit: 'hours', enabled: true },
  { key: 'payment_pending', label: 'Payment pending too long', threshold: 48, unit: 'hours', enabled: true },
  { key: 'lead_inactivity', label: 'Lead without activity', threshold: 3, unit: 'days', enabled: true },
  { key: 'followup_overdue', label: 'Follow-up overdue', threshold: 0, unit: 'hours', enabled: true },
  { key: 'staff_below_target', label: 'Staff below daily call target', threshold: 50, unit: 'percent', enabled: true },
  { key: 'staff_unworked_leads', label: 'Too many unworked leads', threshold: 25, unit: 'count', enabled: true },
];

const LEADERBOARD_WEIGHTS = {
  revenueCollected: 30,
  successfulSales: 20,
  leadConversion: 15,
  positiveLeads: 10,
  demoCompletion: 10,
  callingPerformance: 5,
  followUpCompletion: 5,
  targetAchievement: 5,
};

const IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone', required: true },
  { key: 'alternatePhone', label: 'Alternate phone' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'district', label: 'District' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'source', label: 'Source' },
  { key: 'category', label: 'Category' },
  { key: 'priority', label: 'Priority' },
  { key: 'quality', label: 'Quality' },
  { key: 'expectedRevenue', label: 'Expected revenue' },
  { key: 'notes', label: 'Notes' },
  { key: 'tags', label: 'Tags' },
];

const HEADER_ALIASES = {
  name: ['name', 'full name', 'customer name', 'lead name', 'contact name'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number'],
  alternatePhone: ['alternate phone', 'alt phone', 'phone 2', 'secondary phone', 'alternate number'],
  email: ['email', 'email address', 'mail'],
  company: ['company', 'business', 'business name', 'company name', 'organisation', 'organization'],
  district: ['district'],
  city: ['city', 'town'],
  state: ['state', 'province'],
  country: ['country'],
  source: ['source', 'lead source'],
  category: ['category', 'lead category'],
  priority: ['priority'],
  quality: ['quality', 'lead quality'],
  expectedRevenue: ['expected revenue', 'revenue', 'deal value', 'amount'],
  notes: ['notes', 'note', 'remarks', 'comment'],
  tags: ['tags', 'tag'],
};

const CALL_TYPES = ['incoming', 'outgoing', 'missed'];
const CALL_STATUSES = ['connected', 'not_connected', 'missed', 'rejected', 'unknown'];
const DATA_SOURCES = ['android_sync', 'manual', 'demo_seed'];

const COMPANY = {
  legalName: 'DOABLINK PRIVATE LIMITED',
  productName: 'DoablinkOrbit',
};

module.exports = {
  ROLES,
  ROLE_RANK,
  LEAD_SOURCES,
  LEAD_STATUSES,
  PIPELINE_STAGES,
  PRIORITIES,
  QUALITIES,
  TARGET_TYPES,
  WON_STATUSES,
  POSITIVE_STATUSES,
  CONNECTED_LEAD_STATUSES,
  LOST_STATUSES,
  ALERT_RULES,
  LEADERBOARD_WEIGHTS,
  IMPORT_FIELDS,
  HEADER_ALIASES,
  CALL_TYPES,
  CALL_STATUSES,
  DATA_SOURCES,
  COMPANY,
};
