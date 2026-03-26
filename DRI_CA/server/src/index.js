// ============================================================
// DRI & CA — Express Server Entry Point
// ============================================================
// Disaster Resilience Intelligence & Community Awareness API.
//
// All routes are versioned under /api/v1/
// Swagger docs available at /api/docs
//
// Modules:
//   /api/v1/health        — Server health check
//   /api/v1/feasibility   — Site feasibility (PostGIS spatial)
//   /api/v1/zones         — Hazard zone data (GeoJSON)
//   /api/v1/remediation   — XAI structural recommendations
//   /api/v1/simplify      — Jargon simplification
//   /api/v1/translate     — Bhashini NMT/TTS translation
//   /api/v1/alerts        — Community alerts CRUD
//   /api/v1/tips          — Seasonal awareness tips
// ============================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables FIRST
dotenv.config();

import { verifyConnection } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { logger } from './utils/logger.js';
import * as response from './utils/apiResponse.js';

// Route imports
import feasibilityRouter from './routes/feasibility.js';
import zonesRouter from './routes/zones.js';
import remediationRouter from './routes/remediation.js';
import simplifyRouter from './routes/simplify.js';
import translateRouter from './routes/translate.js';
import alertsRouter from './routes/alerts.js';
import tipsRouter from './routes/tips.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// ──────────────────────────────────────────────────────────────
// Middleware Stack
// ──────────────────────────────────────────────────────────────

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,  // Disabled for Swagger UI
  crossOriginEmbedderPolicy: false,
}));

// CORS — support multiple origins
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parse JSON request bodies (limit 1MB)
app.use(express.json({ limit: '1mb' }));

// Rate limiting
app.use('/api/', createRateLimiter());

// Request logging with timing
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP', `${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ──────────────────────────────────────────────────────────────
// Swagger / OpenAPI Documentation
// ──────────────────────────────────────────────────────────────

let swaggerSetup = false;
try {
  const swaggerUi = await import('swagger-ui-express');
  const YAML = await import('yamljs');
  const specPath = join(__dirname, '..', 'docs', 'openapi.yaml');
  const swaggerDoc = YAML.default.load(specPath);
  app.use('/api/docs', swaggerUi.default.serve, swaggerUi.default.setup(swaggerDoc, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'DRI & CA API Documentation',
  }));
  swaggerSetup = true;
  logger.info('Swagger', 'API docs available at /api/docs');
} catch (err) {
  logger.warn('Swagger', `Docs not available: ${err.message}`);
}

// ──────────────────────────────────────────────────────────────
// API Routes — v1
// ──────────────────────────────────────────────────────────────

// Health check
app.get('/api/v1/health', async (_req, res) => {
  let dbStatus = 'unknown';
  try {
    const { default: pool } = await import('./config/db.js');
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  return response.success(res, {
    service: 'DRI & CA API',
    version: '1.0.0',
    status: 'operational',
    database: dbStatus,
    documentation: swaggerSetup ? '/api/docs' : 'unavailable',
    timestamp: new Date().toISOString(),
    endpoints: {
      feasibility: '/api/v1/feasibility',
      zones:       '/api/v1/zones',
      remediation: '/api/v1/remediation',
      simplify:    '/api/v1/simplify',
      translate:   '/api/v1/translate',
      alerts:      '/api/v1/alerts',
      tips:        '/api/v1/tips',
    },
  });
});

// Module routes
app.use('/api/v1/feasibility', feasibilityRouter);
app.use('/api/v1/zones',       zonesRouter);
app.use('/api/v1/remediation', remediationRouter);
app.use('/api/v1/simplify',    simplifyRouter);
app.use('/api/v1/translate',   translateRouter);
app.use('/api/v1/alerts',      alertsRouter);
app.use('/api/v1/tips',        tipsRouter);

// ──────────────────────────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────────────────────────

// 404 handler
app.use((req, res) => {
  return response.error(res, `Endpoint ${req.method} ${req.path} not found`, 404, 'NOT_FOUND');
});

// Centralized error handler
app.use(errorHandler);

// ──────────────────────────────────────────────────────────────
// Server Startup
// ──────────────────────────────────────────────────────────────

async function start() {
  await verifyConnection();

  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║                                                      ║');
    console.log('║   🛡️  DRI & CA — Disaster Resilience API             ║');
    console.log(`║   🌐 Server:  http://localhost:${PORT}                    ║`);
    console.log(`║   📖 Docs:    http://localhost:${PORT}/api/docs            ║`);
    console.log(`║   💚 Health:  http://localhost:${PORT}/api/v1/health       ║`);
    console.log('║                                                      ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
  });
}

start();
