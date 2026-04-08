import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayLogData } from './build-daylog-data.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(rootDir, 'data-source/daylog/entries.json');
const logicalTimeZone = 'Asia/Tokyo';
const logicalDayStartHour = 4;
const defaultModel = process.env.TRACKING_SITE_DAYLOG_MODEL || 'gpt-5.4';

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY || process.env.TRACKING_SITE_OPENAI_API_KEY || '';
}

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function shiftDateString(dateString, offsetDays) {
  const [year, month, day] = String(dateString)
    .split('-')
    .map((value) => Number(value || 0));
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return formatDateInTimeZone(shifted, 'UTC');
}

export function getLogicalDayString(date = new Date()) {
  const shifted = new Date(date.getTime() - logicalDayStartHour * 60 * 60 * 1000);
  return formatDateInTimeZone(shifted, logicalTimeZone);
}

function normalizeEstimate(estimate) {
  if (!estimate || typeof estimate !== 'object') {
    return null;
  }

  const pages = Number(estimate.pages || 0);
  const minutes = Number(estimate.minutes || 0);
  if (pages <= 0 || minutes <= 0) {
    return null;
  }

  return {
    pages: Math.round(pages),
    minutes: Math.round(minutes),
  };
}

function normalizeNote(note) {
  if (typeof note === 'string') {
    const text = note.trim();
    return text ? { text, estimate: null } : null;
  }

  if (!note || typeof note !== 'object') {
    return null;
  }

  const text = String(note.text || '').trim();
  if (!text) {
    return null;
  }

  return {
    text,
    estimate: normalizeEstimate(note.estimate),
  };
}

function normalizeEntry(entry) {
  return {
    date: String(entry?.date || ''),
    notes: Array.isArray(entry?.notes) ? entry.notes.map(normalizeNote).filter(Boolean) : [],
    anki: entry?.anki && typeof entry.anki === 'object'
      ? {
          reviewCount: Number(entry.anki.reviewCount || 0),
          distinctCards: Number(entry.anki.distinctCards || 0),
          minutes: Number(entry.anki.minutes || 0),
        }
      : null,
  };
}

function stripCodeFence(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

function extractOutputText(responsePayload) {
  if (typeof responsePayload?.output_text === 'string' && responsePayload.output_text.trim()) {
    return responsePayload.output_text.trim();
  }

  const segments = [];
  const output = Array.isArray(responsePayload?.output) ? responsePayload.output : [];
  output.forEach((item) => {
    if (item?.type !== 'message' || !Array.isArray(item.content)) {
      return;
    }

    item.content.forEach((content) => {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        segments.push(content.text);
      }
    });
  });

  return segments.join('\n').trim();
}

function readSourceEntries() {
  return JSON.parse(readFileSync(sourcePath, 'utf8')).map(normalizeEntry);
}

function writeSourceEntries(entries) {
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function sanitizeModelEntry(candidate, fallbackDate) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(candidate?.date || ''))
    ? String(candidate.date)
    : fallbackDate;
  const notes = Array.isArray(candidate?.notes)
    ? candidate.notes.map(normalizeNote).filter(Boolean)
    : [];

  if (!notes.length) {
    throw new Error('The model did not return any usable notes.');
  }

  return {
    date,
    notes,
  };
}

function buildPrompt({ inputText, entries, logicalDate }) {
  const recentEntries = sortEntries(entries).slice(0, 14);
  const logicalYesterday = shiftDateString(logicalDate, -1);

  return [
    'You update a private daily log that is displayed in Japanese.',
    'Return strict JSON only. Do not wrap it in markdown fences.',
    'The JSON must match this shape:',
    '{"date":"YYYY-MM-DD","notes":[{"text":"string","estimate":{"pages":123,"minutes":45}|null}]}',
    '',
    'Rules:',
    `- Use Asia/Tokyo time with a 4:00 AM day boundary. The current logical date is ${logicalDate}.`,
    `- If the user says 今日 or "today", default to ${logicalDate}. If the user says 昨日 or "yesterday", default to ${logicalYesterday}.`,
    '- Merge the new message into the chosen date instead of duplicating notes.',
    '- Keep existing notes on that date unless the new message clearly corrects or replaces them.',
    '- Keep reading-progress notes near the top when they exist.',
    '- Write natural Japanese.',
    '- You may wrap media titles in <em>...</em> when it improves readability.',
    '- Never invent or edit Anki stats.',
    '- Do not invent page or time estimates. Keep an existing estimate only if you keep that note and it still applies.',
    '- For brand new notes, set estimate to null unless the user explicitly stated both a page amount and a time amount.',
    '- Keep the response focused on the updated notes for the chosen date only.',
    '',
    'Recent entries JSON:',
    JSON.stringify(recentEntries, null, 2),
    '',
    'New user input:',
    inputText,
  ].join('\n');
}

async function requestStructuredDayLogUpdate({ inputText, entries, logicalDate }) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: defaultModel,
      input: [
        {
          role: 'user',
          content: buildPrompt({ inputText, entries, logicalDate }),
        },
      ],
      max_output_tokens: 1200,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const outputText = stripCodeFence(extractOutputText(payload));
  if (!outputText) {
    throw new Error('The model returned an empty response.');
  }

  try {
    return sanitizeModelEntry(JSON.parse(outputText), logicalDate);
  } catch (error) {
    throw new Error(`Could not parse the model response as JSON: ${error.message}`);
  }
}

function upsertEntry(entries, nextEntry) {
  const normalizedEntry = normalizeEntry(nextEntry);
  const existingIndex = entries.findIndex((entry) => entry.date === normalizedEntry.date);

  if (existingIndex === -1) {
    return sortEntries([
      ...entries,
      {
        ...normalizedEntry,
        anki: null,
      },
    ]);
  }

  const existingEntry = normalizeEntry(entries[existingIndex]);
  const updatedEntries = [...entries];
  updatedEntries[existingIndex] = {
    ...existingEntry,
    notes: normalizedEntry.notes,
  };

  return sortEntries(updatedEntries);
}

export function getDayLogAiStatus() {
  return {
    enabled: Boolean(getOpenAiApiKey()),
    model: defaultModel,
    timeZone: logicalTimeZone,
    dayStartHour: logicalDayStartHour,
  };
}

export async function processDayLogInput(inputText, now = new Date()) {
  const trimmedInput = String(inputText || '').trim();
  if (!trimmedInput) {
    throw new Error('Log input is empty.');
  }

  const entries = readSourceEntries();
  const logicalDate = getLogicalDayString(now);
  const nextEntry = await requestStructuredDayLogUpdate({
    inputText: trimmedInput,
    entries,
    logicalDate,
  });
  const updatedEntries = upsertEntry(entries, nextEntry);

  writeSourceEntries(updatedEntries);
  const builtEntries = buildDayLogData();

  return {
    date: nextEntry.date,
    entries: builtEntries,
    model: defaultModel,
  };
}
