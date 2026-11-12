require('dotenv').config();
const http = require('http');
const createApp = require('./app');
const { connectDb } = require('./config/db');
const { initSocket } = require('./sockets');
const { startJobs } = require('./jobs/scheduler');
const { seedDemo } = require('./seed/seed');

async function main() {
  await connectDb();
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO === 'true') {
    const result = await seedDemo();
    console.log(result.seeded ? 'Demo accounts and sample data are ready.' : 'Demo reference data verified. Existing demo leads were left in place.');
  } else if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO === 'true') {
    console.error('SEED_DEMO is ignored in production. Demo accounts were not created.');
  }
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  startJobs();
  const port = Number(process.env.PORT || 5000);
  server.listen(port, () => {
    console.log(`DoablinkOrbit API listening on ${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
