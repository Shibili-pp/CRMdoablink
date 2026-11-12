const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const createApp = require('../src/app');
const { seedDemo } = require('../src/seed/seed');
const { Lead } = require('../src/models');
const { assertHourlySums } = require('../src/services/hourly');
const { dateKeyFromDate } = require('../src/utils/time');

let mongod;
let app;

async function login(username) {
  const response = await request(app).post('/api/v1/auth/login').send({ username, password: '1234567' });
  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  return response.body.data;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await seedDemo();
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('DoablinkOrbit acceptance', () => {
  test('all five demo roles sign in and receive different dashboards', async () => {
    const roles = ['owner', 'superadmin', 'admin', 'teamleader', 'staff'];
    const seen = new Set();
    for (const username of roles) {
      const session = await login(username);
      expect(session.user.isDemo).toBe(true);
      expect(session.user.username).toBe(username);
      const dashboard = await request(app).get('/api/v1/dashboards/me').set('Authorization', `Bearer ${session.accessToken}`);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.data.role).toBe(session.user.role);
      expect(dashboard.body.data.cards.length).toBeGreaterThan(3);
      expect(dashboard.body.data.period.preset).toBe('today');
      seen.add(session.user.role);
    }
    expect(seen.size).toBe(5);
  });

  test('backend permissions block staff from audit logs and company user creation', async () => {
    const staff = await login('staff');
    const admin = await login('admin');
    const owner = await login('owner');
    const denied = await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${staff.accessToken}`);
    expect(denied.status).toBe(403);
    const createOwner = await request(app).post('/api/v1/users').set('Authorization', `Bearer ${admin.accessToken}`).send({
      username: 'newowner', email: 'newowner@example.com', password: '1234567', name: 'New Owner', role: 'OWNER',
    });
    expect(createOwner.status).toBe(403);
    const audits = await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(audits.status).toBe(200);
    expect(audits.body.data.length).toBeGreaterThan(0);
  });

  test('branch scope hides Kochi leads from the head-office admin', async () => {
    const owner = await login('owner');
    const admin = await login('admin');
    const ownerLeads = await request(app).get('/api/v1/leads?limit=100').set('Authorization', `Bearer ${owner.accessToken}`);
    const adminLeads = await request(app).get('/api/v1/leads?limit=100').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(ownerLeads.body.meta.total).toBeGreaterThan(adminLeads.body.meta.total);
    expect(adminLeads.body.data.some((lead) => lead.name === 'Kochi Walk-in')).toBe(false);
  });

  test('import preview, duplicate detection and bucket commit work', async () => {
    const admin = await login('admin');
    const csv = 'Name,Phone,Source\nImport One,9900000301,Website\nImport Two,9900000301,Website\nBad Row,123,Website\n';
    const preview = await request(app)
      .post('/api/v1/lead-imports')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .attach('file', Buffer.from(csv), 'leads.csv');
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.duplicates).toBeGreaterThan(0);
    expect(preview.body.data.summary.invalid).toBeGreaterThan(0);
    const committed = await request(app)
      .post(`/api/v1/lead-imports/${preview.body.data._id}/commit`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ skipDuplicates: true, updateExisting: false });
    expect(committed.status).toBe(200);
    expect(committed.body.data.summary.imported).toBe(1);
    const bucket = await request(app).get('/api/v1/leads?view=bucket&q=Import One').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(bucket.body.data[0].bucketStatus).toBe('unassigned');
    expect(bucket.body.data[0].assignedTo).toBeNull();
  });

  test('assignment conflict keeps a single owner and swap preserves history', async () => {
    const admin = await login('admin');
    const staff = await login('staff');
    const leader = await login('teamleader');
    const bucket = await request(app).get('/api/v1/leads?view=bucket&limit=1').set('Authorization', `Bearer ${admin.accessToken}`);
    const leadId = bucket.body.data[0]._id;
    const first = await request(app).post('/api/v1/lead-assignments').set('Authorization', `Bearer ${admin.accessToken}`).send({
      leadIds: [leadId], staffId: staff.user.id, reason: 'First owner',
    });
    const second = await request(app).post('/api/v1/lead-assignments').set('Authorization', `Bearer ${admin.accessToken}`).send({
      leadIds: [leadId], staffId: leader.user.id, reason: 'Should conflict', expectedStaffId: null,
    });
    expect(first.body.data.assigned).toBe(1);
    expect(second.body.data.conflicts.length).toBe(1);
    const swap = await request(app).post('/api/v1/lead-swaps').set('Authorization', `Bearer ${staff.accessToken}`).send({
      leadId, toStaff: leader.user.id, reason: 'Customer asked for a transfer',
    });
    expect(swap.status).toBe(201);
    const approved = await request(app).post(`/api/v1/lead-swaps/${swap.body.data._id}/approve`).set('Authorization', `Bearer ${admin.accessToken}`).send({
      toStaff: leader.user.id, reviewNote: 'Approved',
    });
    expect(approved.status).toBe(200);
    const history = await request(app).get(`/api/v1/leads/${leadId}/involvement`).set('Authorization', `Bearer ${admin.accessToken}`);
    expect(history.body.data.previousOwners.length).toBeGreaterThan(0);
    const timeline = await request(app).get(`/api/v1/leads/${leadId}/timeline`).set('Authorization', `Bearer ${admin.accessToken}`);
    expect(timeline.body.data.some((row) => row.type === 'lead_swapped' || row.type === 'lead_assigned')).toBe(true);
  });

  test('android sync matches a lead, keeps ambiguous calls unattached, and audits recording access', async () => {
    const staff = await login('staff');
    const owner = await login('owner');
    const registered = await request(app).post('/api/v1/android/devices/register').set('Authorization', `Bearer ${staff.accessToken}`).send({
      deviceIdentifier: 'handset-demo-1',
      deviceName: 'Demo handset',
      consentAccepted: true,
      contactsConsent: true,
      callLogPermission: 'granted',
      contactsPermission: 'granted',
    });
    expect(registered.status).toBe(201);
    const deviceToken = registered.body.data.deviceToken;
    const lead = await Lead.findOne({ phoneNormalized: '919900000002', isDemo: true });
    const synced = await request(app).post('/api/v1/android/calls/sync').set('Authorization', `Bearer ${deviceToken}`).send({
      events: [
        {
          androidEventId: 'evt-match-1', phone: '9900000002', callType: 'outgoing', startedAt: new Date().toISOString(),
          durationSeconds: 45, status: 'connected', recordingId: 'REC-1001', recordingReference: 'private://rec/1001', recordingProvider: 'device',
        },
        {
          androidEventId: 'evt-unknown-1', phone: '9900000991', callType: 'missed', startedAt: new Date().toISOString(), durationSeconds: 0, status: 'missed',
        },
      ],
    });
    expect(synced.status).toBe(200);
    expect(synced.body.data.matched).toBe(1);
    expect(synced.body.data.unmatched).toBe(1);
    const again = await request(app).post('/api/v1/android/calls/sync').set('Authorization', `Bearer ${deviceToken}`).send({
      events: [{ androidEventId: 'evt-match-1', phone: '9900000002', callType: 'outgoing', startedAt: new Date().toISOString(), durationSeconds: 45, status: 'connected' }],
    });
    expect(again.body.data.duplicates).toBe(1);
    await Lead.create({
      leadCode: 'ORB-DUP-1', name: 'Duplicate A', phone: '9900000888', phoneNormalized: '919900000888', source: 'Website', status: 'fresh', branch: lead.branch, createdBy: owner.user.id,
    });
    await Lead.create({
      leadCode: 'ORB-DUP-2', name: 'Duplicate B', phone: '9900000888', phoneNormalized: '919900000888', source: 'Website', status: 'fresh', branch: lead.branch, createdBy: owner.user.id,
    });
    const ambiguous = await request(app).post('/api/v1/android/calls/sync').set('Authorization', `Bearer ${deviceToken}`).send({
      events: [{ androidEventId: 'evt-ambiguous-1', phone: '9900000888', callType: 'incoming', startedAt: new Date().toISOString(), durationSeconds: 10, status: 'connected' }],
    });
    expect(ambiguous.body.data.ambiguous).toBe(1);
    const search = await request(app).get('/api/v1/call-recordings?recordingId=REC-1001').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(search.body.data.length).toBe(1);
    expect(search.body.data[0].accessReference).toBeUndefined();
    const revealed = await request(app).get(`/api/v1/call-recordings/${search.body.data[0]._id}`).set('Authorization', `Bearer ${owner.accessToken}`);
    expect(revealed.body.data.accessReference).toBe('private://rec/1001');
    const audits = await request(app).get('/api/v1/audit-logs?action=recording.access').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(audits.body.data.some((row) => row.action === 'recording.access')).toBe(true);
    const contacts = await request(app).post('/api/v1/android/contacts/sync').set('Authorization', `Bearer ${deviceToken}`).send({
      contacts: [{ deviceContactId: 'c1', name: 'Known Buyer', phone: '9900000003' }, { deviceContactId: 'c2', name: 'Personal Friend', phone: '9900000777' }],
    });
    expect(contacts.body.data.inserted).toBe(2);
    const list = await request(app).get('/api/v1/contacts?matchStatus=unmatched').set('Authorization', `Bearer ${staff.accessToken}`);
    expect(list.body.data.some((row) => row.name === 'Personal Friend')).toBe(true);
    const friend = list.body.data.find((row) => row.name === 'Personal Friend');
    const created = await request(app).post(`/api/v1/contacts/${friend._id}/create-lead`).set('Authorization', `Bearer ${staff.accessToken}`);
    expect(created.status).toBe(201);
    expect(created.body.data.assignedTo).toBeTruthy();
  });

  test('follow-ups, targets, revenue, hourly totals and exports are calculated from stored records', async () => {
    const staff = await login('staff');
    const admin = await login('admin');
    const overdue = await request(app).get('/api/v1/followups?bucket=overdue').set('Authorization', `Bearer ${staff.accessToken}`);
    expect(overdue.body.data.length).toBeGreaterThan(0);
    const summary = await request(app).get('/api/v1/revenue/summary').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(summary.body.data.collected).toBe(30000);
    expect(summary.body.data.confirmed).toBe(80000);
    expect(summary.body.data.expectedPipeline).not.toBe(summary.body.data.collected);
    const targetList = await request(app).get('/api/v1/targets').set('Authorization', `Bearer ${staff.accessToken}`);
    expect(targetList.body.data[0].progress.actual).toBeGreaterThan(0);
    const hourly = await request(app).get('/api/v1/hourly-reports?ensure=1').set('Authorization', `Bearer ${staff.accessToken}`);
    expect(hourly.status).toBe(200);
    const check = await assertHourlySums(staff.user.id, dateKeyFromDate(new Date(), 'Asia/Kolkata'));
    expect(check.matches).toBe(true);
    const binary = (url) => request(app).get(url).set('Authorization', `Bearer ${admin.accessToken}`).buffer(true).parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    const pdf = await binary('/api/v1/reports/call_analytics/export?format=pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    const xlsx = await binary('/api/v1/reports/staff_performance/export?format=xlsx');
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.slice(0, 2).toString()).toBe('PK');
  });
});
