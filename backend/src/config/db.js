const dns = require('dns');
const mongoose = require('mongoose');

dns.setDefaultResultOrder('ipv4first');

async function connectDb(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to backend/.env. Do not commit credentials.');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { family: 4, serverSelectionTimeoutMS: 45000 });
  return mongoose.connection;
}

module.exports = { connectDb };
