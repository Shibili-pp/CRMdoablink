const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { sanitize, errorHandler } = require('./middleware');
const api = require('./routes/api');
const openapi = require('./docs/openapi');

function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const origins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((item) => item.trim());
  app.use(cors({ origin: origins, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(sanitize);
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
    const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
    const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
    app.use('/api/v1/auth/login', loginLimiter);
    app.use('/api/', apiLimiter);
  }
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.use('/api/v1', api);
  if (process.env.SERVE_FRONTEND === 'true') {
    const dist = path.join(__dirname, '../../frontend/dist');
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      return res.sendFile(path.join(dist, 'index.html'));
    });
  }
  app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found', data: null });
  });
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
