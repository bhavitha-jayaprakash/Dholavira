// ============================================================
// Bhashini API Client — Neural Machine Translation & TTS
// ============================================================
// Integrates with the Digital India Bhashini (ULCA) platform
// for English ↔ Malayalam translation and Text-to-Speech.
//
// API Docs: https://bhashini.gitbook.io/bhashini-apis
//
// GRACEFUL DEGRADATION:
// If BHASHINI_API_KEY is not set, returns mock translations
// with a clear warning flag so development can continue
// without external API access.
// ============================================================

import { logger } from '../utils/logger.js';

const BHASHINI_USER_ID    = process.env.BHASHINI_USER_ID || '';
const BHASHINI_API_KEY    = process.env.BHASHINI_API_KEY || '';
const PIPELINE_URL        = process.env.BHASHINI_PIPELINE_URL || 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
const INFERENCE_URL       = process.env.BHASHINI_INFERENCE_URL || 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';

const TAG = 'Bhashini';

/**
 * Check if Bhashini credentials are configured.
 * @returns {boolean}
 */
export function isBhashiniConfigured() {
  return Boolean(BHASHINI_USER_ID && BHASHINI_API_KEY);
}

// ──────────────────────────────────────────────────────────────
// Pipeline Configuration Discovery
// ──────────────────────────────────────────────────────────────

// Cache for discovered pipeline models
let pipelineCache = {};

/**
 * Discover the best available NMT/TTS model pipeline from Bhashini.
 *
 * @param {'translation'|'tts'} taskType
 * @param {string} sourceLang - e.g. 'en'
 * @param {string} targetLang - e.g. 'ml' (Malayalam)
 * @returns {Promise<object|null>} Pipeline config with serviceId and modelId
 */
async function discoverPipeline(taskType, sourceLang, targetLang) {
  const cacheKey = `${taskType}_${sourceLang}_${targetLang}`;
  if (pipelineCache[cacheKey]) return pipelineCache[cacheKey];

  if (!isBhashiniConfigured()) return null;

  try {
    const pipelineTasks = [];

    if (taskType === 'translation') {
      pipelineTasks.push({
        taskType: 'translation',
        config: {
          language: { sourceLanguage: sourceLang, targetLanguage: targetLang },
        },
      });
    } else if (taskType === 'tts') {
      pipelineTasks.push({
        taskType: 'tts',
        config: {
          language: { sourceLanguage: targetLang },
        },
      });
    }

    const response = await fetch(PIPELINE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'userID': BHASHINI_USER_ID,
        'ulcaApiKey': BHASHINI_API_KEY,
      },
      body: JSON.stringify({ pipelineTasks }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(TAG, `Pipeline discovery failed: ${response.status}`, { body: errText });
      return null;
    }

    const data = await response.json();

    // Extract the inference API key and service config
    const pipelineConfig = {
      inferenceApiKey: data.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value || BHASHINI_API_KEY,
      callbackUrl: data.pipelineInferenceAPIEndPoint?.callbackUrl || INFERENCE_URL,
    };

    // Get model details from the response
    if (data.pipelineResponseConfig && data.pipelineResponseConfig.length > 0) {
      const config = data.pipelineResponseConfig[0].config?.[0];
      if (config) {
        pipelineConfig.serviceId = config.serviceId;
        pipelineConfig.modelId = config.modelId;
      }
    }

    pipelineCache[cacheKey] = pipelineConfig;
    logger.info(TAG, `Pipeline discovered for ${cacheKey}`, { serviceId: pipelineConfig.serviceId });
    return pipelineConfig;

  } catch (err) {
    logger.error(TAG, `Pipeline discovery error: ${err.message}`);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Translation (NMT)
// ──────────────────────────────────────────────────────────────

/**
 * Translate text using Bhashini NMT.
 *
 * @param {string} text - Text to translate
 * @param {string} [sourceLang='en'] - Source language code
 * @param {string} [targetLang='ml'] - Target language code (default: Malayalam)
 * @returns {Promise<object>} Translation result
 */
export async function translateText(text, sourceLang = 'en', targetLang = 'ml') {
  if (!text || typeof text !== 'string') {
    return { translated: '', source: text, mock: false, error: 'Empty input' };
  }

  // ── Mock mode when credentials are absent ──
  if (!isBhashiniConfigured()) {
    logger.warn(TAG, 'Bhashini not configured — returning mock translation');
    return {
      original: text,
      translated: `[MOCK ${targetLang.toUpperCase()}] ${text}`,
      sourceLang,
      targetLang,
      mock: true,
      warning: 'Bhashini API credentials not configured. Set BHASHINI_USER_ID and BHASHINI_API_KEY in .env for real translations.',
    };
  }

  try {
    // Discover the pipeline
    const pipeline = await discoverPipeline('translation', sourceLang, targetLang);
    if (!pipeline) {
      throw new Error('Failed to discover Bhashini translation pipeline');
    }

    // Call the inference endpoint
    const response = await fetch(pipeline.callbackUrl || INFERENCE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': pipeline.inferenceApiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'translation',
            config: {
              language: { sourceLanguage: sourceLang, targetLanguage: targetLang },
              serviceId: pipeline.serviceId,
            },
          },
        ],
        inputData: {
          input: [{ source: text }],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Bhashini API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const translated = data.pipelineResponse?.[0]?.output?.[0]?.target || '';

    logger.info(TAG, `Translated ${text.length} chars ${sourceLang}→${targetLang}`);

    return {
      original: text,
      translated,
      sourceLang,
      targetLang,
      mock: false,
      serviceId: pipeline.serviceId,
    };

  } catch (err) {
    logger.error(TAG, `Translation failed: ${err.message}`);
    return {
      original: text,
      translated: '',
      sourceLang,
      targetLang,
      mock: false,
      error: err.message,
    };
  }
}

// ──────────────────────────────────────────────────────────────
// Text-to-Speech (TTS)
// ──────────────────────────────────────────────────────────────

/**
 * Convert text to speech using Bhashini TTS.
 *
 * @param {string} text - Text to synthesize
 * @param {string} [lang='ml'] - Language code
 * @param {'male'|'female'} [gender='female'] - Voice gender
 * @returns {Promise<object>} TTS result with base64 audio
 */
export async function textToSpeech(text, lang = 'ml', gender = 'female') {
  if (!text || typeof text !== 'string') {
    return { audioContent: null, error: 'Empty input' };
  }

  // ── Mock mode ──
  if (!isBhashiniConfigured()) {
    logger.warn(TAG, 'Bhashini not configured — returning mock TTS');
    return {
      text,
      lang,
      gender,
      audioContent: null,
      audioFormat: 'wav',
      mock: true,
      warning: 'Bhashini API credentials not configured. Set BHASHINI_USER_ID and BHASHINI_API_KEY in .env for real TTS.',
    };
  }

  try {
    const pipeline = await discoverPipeline('tts', lang, lang);
    if (!pipeline) {
      throw new Error('Failed to discover Bhashini TTS pipeline');
    }

    const response = await fetch(pipeline.callbackUrl || INFERENCE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': pipeline.inferenceApiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'tts',
            config: {
              language: { sourceLanguage: lang },
              serviceId: pipeline.serviceId,
              gender,
            },
          },
        ],
        inputData: {
          input: [{ source: text }],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Bhashini TTS error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const audioContent = data.pipelineResponse?.[0]?.audio?.[0]?.audioContent || null;

    logger.info(TAG, `TTS generated for ${text.length} chars in ${lang}`);

    return {
      text,
      lang,
      gender,
      audioContent, // Base64-encoded WAV
      audioFormat: 'wav',
      mock: false,
      serviceId: pipeline.serviceId,
    };

  } catch (err) {
    logger.error(TAG, `TTS failed: ${err.message}`);
    return {
      text,
      lang,
      gender,
      audioContent: null,
      error: err.message,
    };
  }
}

/**
 * Returns supported language pairs and their status.
 */
export function getSupportedLanguages() {
  return {
    configured: isBhashiniConfigured(),
    translation: [
      { source: 'en', target: 'ml', label: 'English → Malayalam' },
      { source: 'ml', target: 'en', label: 'Malayalam → English' },
      { source: 'en', target: 'hi', label: 'English → Hindi' },
      { source: 'en', target: 'ta', label: 'English → Tamil' },
      { source: 'en', target: 'kn', label: 'English → Kannada' },
    ],
    tts: [
      { lang: 'ml', label: 'Malayalam', voices: ['male', 'female'] },
      { lang: 'en', label: 'English',   voices: ['male', 'female'] },
      { lang: 'hi', label: 'Hindi',     voices: ['male', 'female'] },
    ],
    note: isBhashiniConfigured()
      ? 'Bhashini API is configured and ready.'
      : 'Bhashini API credentials not set. Endpoints will return mock data. Set BHASHINI_USER_ID and BHASHINI_API_KEY in .env.',
  };
}
