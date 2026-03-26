// ============================================================
// Simplify Route — /api/v1/simplify
// ============================================================
// POST /         — Simplify technical text to layperson language
// GET  /glossary — Return the full domain glossary
//
// Uses a deterministic, rule-based glossary engine. No LLM.
// ============================================================

import { Router } from 'express';
import * as response from '../utils/apiResponse.js';
import { simplifyText, getGlossary } from '../services/simplifier.js';

const router = Router();

// ──────────────────────────────────────────────────────────────
// POST / — Simplify text
// ──────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return response.validationError(res, ['text is required and must be a string']);
  }

  if (text.length > 10000) {
    return response.validationError(res, ['text must be 10,000 characters or less']);
  }

  const result = simplifyText(text);
  return response.success(res, result);
});

// ──────────────────────────────────────────────────────────────
// GET /glossary — Full glossary for reference/display
// ──────────────────────────────────────────────────────────────

router.get('/glossary', (_req, res) => {
  const glossary = getGlossary();
  return response.success(res, glossary, 200, { count: glossary.length });
});

export default router;
