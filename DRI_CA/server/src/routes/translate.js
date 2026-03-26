// ============================================================
// Translate Route — /api/v1/translate
// ============================================================
// POST /             — Translate text (NMT via Bhashini)
// POST /tts          — Text-to-Speech (TTS via Bhashini)
// GET  /languages    — Supported languages and config status
//
// Gracefully degrades to mock mode if Bhashini credentials
// are not configured (useful for development/hackathon demos).
// ============================================================

import { Router } from 'express';
import * as response from '../utils/apiResponse.js';
import {
  translateText,
  textToSpeech,
  getSupportedLanguages,
} from '../services/bhashiniClient.js';

const router = Router();

// ──────────────────────────────────────────────────────────────
// POST / — Translate text
// ──────────────────────────────────────────────────────────────
// Body: { text: string, sourceLang?: string, targetLang?: string }
// Default: English → Malayalam
// ──────────────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { text, sourceLang = 'en', targetLang = 'ml' } = req.body;

    if (!text || typeof text !== 'string') {
      return response.validationError(res, ['text is required and must be a string']);
    }

    if (text.length > 5000) {
      return response.validationError(res, ['text must be 5,000 characters or less']);
    }

    const result = await translateText(text, sourceLang, targetLang);

    if (result.error && !result.mock) {
      return response.error(res, result.error, 502, 'BHASHINI_ERROR');
    }

    return response.success(res, result);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// POST /tts — Text-to-Speech
// ──────────────────────────────────────────────────────────────
// Body: { text: string, lang?: string, gender?: 'male'|'female' }
// Default: Malayalam, female voice
// ──────────────────────────────────────────────────────────────

router.post('/tts', async (req, res, next) => {
  try {
    const { text, lang = 'ml', gender = 'female' } = req.body;

    if (!text || typeof text !== 'string') {
      return response.validationError(res, ['text is required and must be a string']);
    }

    if (text.length > 2000) {
      return response.validationError(res, ['text must be 2,000 characters or less for TTS']);
    }

    if (!['male', 'female'].includes(gender)) {
      return response.validationError(res, ['gender must be "male" or "female"']);
    }

    const result = await textToSpeech(text, lang, gender);

    if (result.error && !result.mock) {
      return response.error(res, result.error, 502, 'BHASHINI_TTS_ERROR');
    }

    return response.success(res, result);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────
// GET /languages — Supported languages and status
// ──────────────────────────────────────────────────────────────

router.get('/languages', (_req, res) => {
  const languages = getSupportedLanguages();
  return response.success(res, languages);
});

export default router;
