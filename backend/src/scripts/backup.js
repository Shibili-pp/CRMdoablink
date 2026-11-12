require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI before taking a backup. The URI is not printed here.');
  process.exit(1);
}
const stamp = new Date().toISOString().slice(0, 10);
const destination = path.join(__dirname, '..', '..', '..', 'backups', stamp);
fs.mkdirSync(destination, { recursive: true });
const result = spawnSync('mongodump', ['--uri', uri, `--out=${destination}`], { stdio: 'inherit' });
if (result.error && result.error.code === 'ENOENT') {
  console.error('mongodump is not installed. Install MongoDB Database Tools, or enable Atlas continuous backup on the cluster.');
  console.error(`Planned output folder: ${destination}`);
  process.exit(1);
}
process.exit(result.status || 0);
