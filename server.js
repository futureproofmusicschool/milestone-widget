import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { google } from 'googleapis';
import bodyParser from 'body-parser';
// fetch is built-in on Node 18+
// If you truly want node-fetch, uncomment here:
// import fetch from 'node-fetch';

config(); // Initialize dotenv

const app = express();

// Add CORS middleware with more permissive settings
app.use(cors({
  origin: [
    'https://www.futureproofmusicschool.com', 
    'https://learn.futureproofmusicschool.com',
    'https://learn-pathway-widget-goals.vercel.app',
    'https://milestone-widget.vercel.app',
    'https://learn-pathway-widget.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));

app.use(bodyParser.json());

// Allow iframe embedding - override any Vercel defaults
app.use((req, res, next) => {
  // Override X-Frame-Options
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  // Set permissive CSP for iframe embedding
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors *;"
  );
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const MILESTONE_SPREADSHEET_ID = process.env.MILESTONE_SPREADSHEET_ID; // Milestone plan spreadsheet (sheet1 with A-F headers)

// ============================================
// LearnWorlds Auth (Client Credentials)
// Per docs: https://www.learnworlds.dev/docs/api/b6b6c2d4906e9-authentication
// ============================================
const lwTokenCache = {
  accessToken: null,
  expiresAt: 0
};

async function getLearnWorldsAccessToken() {
  const clientId = process.env.LEARNWORLDS_CLIENT_ID;
  const clientSecret = process.env.LEARNWORLDS_CLIENT_SECRET;

  console.log('[LW] Token request init', {
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    clientIdLength: clientId?.length,
    secretLength: clientSecret?.length,
    clientIdPreview: clientId ? clientId.slice(0, 20) + '...' : 'missing',
    envKeys: Object.keys(process.env).filter(k => k.includes('LEARN')).join(', '),
    deploymentUrl: process.env.VERCEL_URL || process.env.VERCEL_REGION || 'unknown',
    nodeVersion: process.version
  });

  if (!clientId || !clientSecret) {
    const msg = 'LearnWorlds client credentials missing (LEARNWORLDS_CLIENT_ID / LEARNWORLDS_CLIENT_SECRET)';
    console.error(msg, { hasId: !!clientId, hasSecret: !!clientSecret });
    throw new Error(msg);
  }

  // Return cached token if still valid (renew 60s before expiry)
  if (lwTokenCache.accessToken && Date.now() < (lwTokenCache.expiresAt - 60_000)) {
    console.log('[LW] Using cached token');
    return lwTokenCache.accessToken;
  }

  const tokenUrl = 'https://learn.futureproofmusicschool.com/admin/api/oauth2/access_token';
  
  // Manually construct the body to ensure proper encoding
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId.trim());
  params.append('client_secret', clientSecret.trim());
  const body = params.toString();

  console.log('[LW] Token request details', {
    url: tokenUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'Lw-Client': clientId?.slice(0, 10) + '...'
    },
    bodyLength: body.length,
    bodyPreview: body.replace(/client_secret=[^&]+/, 'client_secret=***').slice(0, 200)
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'Lw-Client': clientId
    },
    body
  });

  if (!resp.ok) {
    const status = resp.status;
    const headersObj = Object.fromEntries([...resp.headers.entries()]);
    const bodyText = await resp.text();
    console.error('[LW] Token fetch failed', { 
      status, 
      headers: headersObj, 
      body: bodyText,
      requestUrl: tokenUrl,
      requestBody: body.replace(/client_secret=[^&]+/, 'client_secret=***'),
      clientIdUsed: clientId
    });
    throw new Error('Failed to obtain LearnWorlds access token');
  }

  const data = await resp.json();
  // LearnWorlds returns token in tokenData object
  const tokenData = data.tokenData || data;
  const accessToken = tokenData.access_token;
  const expiresIn = Number(tokenData.expires_in || 3600);
  lwTokenCache.accessToken = accessToken;
  lwTokenCache.expiresAt = Date.now() + expiresIn * 1000;
  console.log('[LW] Obtained token. Expires in (s):', expiresIn);
  return accessToken;
}

// Utility to parse JSON that may be double-encoded
function parseJsonPossiblyDoubleEncoded(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const first = JSON.parse(text);
    if (typeof first === 'string') {
      try { return JSON.parse(first); } catch (_) { return null; }
    }
    return first;
  } catch (_) {
    return null;
  }
}

function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractJsonObjectFromText(text) {
  if (typeof text !== 'string') return null;
  const decoded = decodeHtmlEntities(text.trim());
  const start = decoded.indexOf('{');
  const end = decoded.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = decoded.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch (_) { return null; }
}

function normalizeMonthlyPlanKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  // Handle both old (monthly_plan) and new (milestones) keys for backward compatibility
  if (typeof obj.milestones === 'string') {
    try {
      const parsed = JSON.parse(obj.milestones);
      if (Array.isArray(parsed)) obj.milestones = parsed;
    } catch (_) {}
  }
  if (typeof obj.monthly_plan === 'string') {
    try {
      const parsed = JSON.parse(obj.monthly_plan);
      if (Array.isArray(parsed)) obj.milestones = parsed; // Convert to new key
    } catch (_) {}
  }
  if (Array.isArray(obj.milestones)) return obj;
  if (Array.isArray(obj.monthly_plan)) {
    return { ...obj, milestones: obj.monthly_plan }; // Convert to new key
  }
  if (Array.isArray(obj.monthlyPlan)) {
    return { ...obj, milestones: obj.monthlyPlan }; // Convert to new key
  }
  return obj;
}

// Loose key matching utilities for plan normalization
function normalizeKeyNameLoose(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getLoose(obj, looseName) {
  if (!obj || typeof obj !== 'object') return undefined;
  const target = normalizeKeyNameLoose(looseName);
  for (const k of Object.keys(obj)) {
    if (normalizeKeyNameLoose(k) === target) return obj[k];
  }
  return undefined;
}

function normalizePlanObjectLoose(planObj) {
  if (!planObj || typeof planObj !== 'object') return null;
  const draft = { ...planObj };
  // Try new key first, then fall back to old keys
  let milestones = draft.milestones;
  if (milestones === undefined) milestones = draft.monthly_plan;
  if (milestones === undefined) milestones = draft.monthlyPlan;
  if (milestones === undefined) milestones = getLoose(draft, 'milestones');
  if (milestones === undefined) milestones = getLoose(draft, 'monthly_plan');
  if (typeof milestones === 'string') {
    const parsed = parseJsonPossiblyDoubleEncoded(milestones) || extractJsonObjectFromText(milestones);
    if (Array.isArray(parsed)) milestones = parsed;
  }
  // Always use new key name in output
  if (Array.isArray(milestones)) draft.milestones = milestones;
  
  // Also handle quarters/quarterly_summary and halves
  if (draft.quarterly_summary && !draft.quarters) {
    draft.quarters = draft.quarterly_summary;
  }
  // Convert quarters to halves if needed
  if (draft.quarters && !draft.halves) {
    draft.halves = draft.quarters;
  }
  
  return draft;
}

// Add a health check endpoint
app.get('/', (req, res) => {
  // Remove X-Frame-Options for root as well
  res.removeHeader('X-Frame-Options');
  res.json({ status: 'ok', message: 'Server is running' });
});

// Add a health check for the API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running' });
});

// Debug endpoint to test OAuth and LearnWorlds connection
app.get('/api/debug/oauth', async (req, res) => {
  const results = {
    environment: {
      deployment: process.env.VERCEL_URL || 'unknown',
      hasClientId: !!process.env.LEARNWORLDS_CLIENT_ID,
      hasClientSecret: !!process.env.LEARNWORLDS_CLIENT_SECRET,
      clientIdLength: process.env.LEARNWORLDS_CLIENT_ID?.length,
      clientIdPreview: process.env.LEARNWORLDS_CLIENT_ID?.slice(0, 20) + '...'
    },
    tokenRequest: null,
    tokenResponse: null,
    testApiCall: null
  };

  try {
    // Step 1: Try to get OAuth token
    const clientId = process.env.LEARNWORLDS_CLIENT_ID;
    const clientSecret = process.env.LEARNWORLDS_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      results.tokenRequest = { error: 'Missing credentials' };
      return res.json(results);
    }

    const tokenUrl = 'https://learn.futureproofmusicschool.com/admin/api/oauth2/access_token';
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId.trim());
    params.append('client_secret', clientSecret.trim());
    const body = params.toString();

    results.tokenRequest = {
      url: tokenUrl,
      bodyLength: body.length,
      bodyPreview: body.replace(/client_secret=[^&]+/, 'client_secret=***')
    };

    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Lw-Client': clientId
      },
      body
    });

    const tokenStatus = tokenResp.status;
    const tokenHeaders = Object.fromEntries([...tokenResp.headers.entries()]);
    const tokenBody = await tokenResp.text();

    results.tokenResponse = {
      status: tokenStatus,
      headers: tokenHeaders,
      body: tokenBody
    };

    if (tokenResp.ok) {
      const parsedResponse = JSON.parse(tokenBody);
      // LearnWorlds returns token in tokenData object
      const tokenData = parsedResponse.tokenData || parsedResponse;
      const accessToken = tokenData.access_token;
      
      // Step 2: Try a test API call with the token
      const testUrl = 'https://learn.futureproofmusicschool.com/admin/api/v2/users';
      const testResp = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Lw-Client': clientId,
          'Accept': 'application/json'
        }
      });

      results.testApiCall = {
        url: testUrl,
        status: testResp.status,
        statusText: testResp.statusText
      };
    }
  } catch (error) {
    results.error = error.message;
  }

  res.json(results);
});

// Lightweight endpoint to get a single course's progress for a user
app.get('/api/course-progress/:userId/course/:courseId', async (req, res) => {
  try {
    const { userId, courseId } = req.params;
    if (!process.env.LEARNWORLDS_CLIENT_ID || !process.env.LEARNWORLDS_CLIENT_SECRET) {
      console.error('LW single-course: Missing client credentials');
      return res.status(500).json({ error: 'Missing LearnWorlds client credentials' });
    }

    // Use the per-course progress endpoint per LearnWorlds docs
    const apiUrl = `https://learn.futureproofmusicschool.com/admin/api/v2/users/${encodeURIComponent(userId)}/courses/${encodeURIComponent(courseId)}/progress`;
    console.log('[LW] GET single-course progress', { userId, courseId, apiUrl });

    // Get dynamic access token
    const accessToken = await getLearnWorldsAccessToken();

    const progressResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Lw-Client': process.env.LEARNWORLDS_CLIENT_ID
      }
    });

    if (!progressResponse.ok) {
      const status = progressResponse.status;
      const headersObj = Object.fromEntries([...progressResponse.headers.entries()]);
      const body = await progressResponse.text();
      console.error('[LW] single-course progress error', { status, headers: headersObj, body: body?.slice(0, 500) });
      return res.status(500).json({ error: 'LearnWorlds upstream error', status, headers: headersObj, body });
    }

    const data = await progressResponse.json();
    console.log('[LW] single-course progress full data:', JSON.stringify(data, null, 2));
    
    // Return the full data object for detailed progress display
    return res.json({ 
      userId, 
      courseId, 
      ...data // Include all fields: status, progress_rate, average_score_rate, time_on_course, etc.
    });
  } catch (error) {
    console.error('Error fetching single course progress:', error);
    return res.status(500).json({ error: 'Failed to fetch course progress' });
  }
});

// ============================================
// MILESTONE ROADMAP ENDPOINTS
// ============================================

// Handle preflight requests for milestone endpoints
app.options('/api/milestone-roadmap/:userId', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

app.options('/api/milestone-roadmap/:userId/complete', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

/**
 * Get user's milestone roadmap plan and progress
 */
app.get('/api/milestone-roadmap/:userId', async (req, res) => {
  // Set CORS headers explicitly for this endpoint
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  try {
    const { userId } = req.params;
    console.log('Fetching milestone roadmap for user:', userId);
    try {
      const id = MILESTONE_SPREADSHEET_ID || '';
      const maskedId = id.slice(0, 6) + '...' + id.slice(-4);
      console.log('Milestone API: Using MILESTONE_SPREADSHEET_ID:', maskedId, 'Range: sheet1!A:F');
    } catch (_) {}
    
    // Read from spreadsheet - using sheet1 as the tab name (lowercase)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: MILESTONE_SPREADSHEET_ID,
      range: 'sheet1!A:F', // Get columns A-F to find user and their data
    });

    const rows = response.data.values || [];
    console.log('Milestone API: rows fetched:', rows.length);
    if (rows.length === 0) return res.status(404).json({ error: 'Sheet empty' });

    // Skip header row; columns are fixed A-F: A=user_id, B=username, E=roadmap_plan, F=roadmap_progress
    const dataRows = rows.slice(1);
    const indexInData = dataRows.findIndex(row => (row[0] || '').trim() === (userId || '').trim());
    const userRowIndex = indexInData === -1 ? -1 : indexInData + 1; // absolute index in rows
    console.log('Milestone API: userRowIndex:', userRowIndex, '(absolute), indexInData:', indexInData);
    if (userRowIndex === -1) {
      console.log('Milestone API: First 10 user_ids sample:', dataRows.slice(0, 10).map(r => r[0]));
      return res.status(404).json({ error: 'User not found' });
    }

    const userRow = rows[userRowIndex];
    // E (4) = roadmap_plan, F (5) = roadmap_progress
    const rawPlan = userRow[4];
    const rawProgress = userRow[5];
    console.log('Milestone API: rawPlan len:', rawPlan ? String(rawPlan).length : 0);
    if (rawPlan) console.log('Milestone API: rawPlan preview:', String(rawPlan).slice(0, 180));

    let roadmapPlan = null;
    let planState = 'none'; // Can be 'none', 'inprogress', or 'ready'
    
    // Check if rawPlan is 'none' or 'inprogress' or empty
    if (!rawPlan || String(rawPlan).trim().toLowerCase() === 'none') {
      planState = 'none';
      roadmapPlan = null;
    } else if (String(rawPlan).trim().toLowerCase() === 'inprogress') {
      planState = 'inprogress';
      roadmapPlan = null;
    } else {
      // Try to parse as JSON
      roadmapPlan = parseJsonPossiblyDoubleEncoded(rawPlan)
        || extractJsonObjectFromText(rawPlan);
      roadmapPlan = normalizeMonthlyPlanKeys(roadmapPlan);
      roadmapPlan = normalizePlanObjectLoose(roadmapPlan);
      
      if (roadmapPlan && (roadmapPlan.milestones || roadmapPlan.monthly_plan)) {
        // Ensure we use the new key name
        if (roadmapPlan.monthly_plan && !roadmapPlan.milestones) {
          roadmapPlan.milestones = roadmapPlan.monthly_plan;
        }
        planState = 'ready';
      } else {
        planState = 'none';
        roadmapPlan = null;
      }
    }

    // Robustly parse progress and ensure correct current milestone semantics
    let roadmapProgress = null;
    try {
      if (typeof rawProgress === 'string') {
        const trimmed = rawProgress.trim();
        if (trimmed && trimmed.toLowerCase() !== 'none') {
          roadmapProgress = parseJsonPossiblyDoubleEncoded(trimmed) || extractJsonObjectFromText(trimmed);
        }
      }
    } catch (_) {
      roadmapProgress = null;
    }

    if (roadmapProgress && typeof roadmapProgress === 'object') {
      try {
        const completed = Array.isArray(roadmapProgress.milestonesCompleted) ? roadmapProgress.milestonesCompleted.map(Number) : [];
        roadmapProgress.milestonesCompleted = completed;
        // Compute current milestone: should be the next milestone after the highest completed one
        // If no milestones are completed, current should be 1
        const nonZeroCompleted = completed.filter(m => m >= 1);
        let computedCurrent = 0;
        if (nonZeroCompleted.length > 0) {
          const maxCompleted = Math.max(...nonZeroCompleted);
          computedCurrent = Math.min(maxCompleted + 1, 10); // Next milestone after highest completed
        } else {
          computedCurrent = 1; // Start at milestone 1 if none completed
        }
        if (!Number.isFinite(roadmapProgress.currentMilestone) || roadmapProgress.currentMilestone !== computedCurrent) {
          roadmapProgress.currentMilestone = computedCurrent;
        }
      } catch (_) {}
    } else {
      roadmapProgress = null;
    }

    console.log('Milestone API: planState:', planState);
    console.log('Milestone API: parsed roadmapPlan present:', !!roadmapPlan, 'keys:', roadmapPlan ? Object.keys(roadmapPlan) : []);
    console.log('Milestone API: has milestones array:', !!(roadmapPlan && Array.isArray(roadmapPlan.milestones)), 'len:', roadmapPlan && Array.isArray(roadmapPlan.milestones) ? roadmapPlan.milestones.length : 'n/a');
    
    res.json({
      userId,
      username: userRow[1] || 'Student',
      roadmapPlan,
      roadmapProgress,
      planState
    });
    
  } catch (error) {
    console.error('Error fetching milestone roadmap:', error);
    res.status(500).json({ error: 'Failed to fetch roadmap data' });
  }
});

// Debug endpoint to introspect parsing of roadmap_plan for a user
app.get('/api/milestone-debug/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: MILESTONE_SPREADSHEET_ID,
      range: 'sheet1!A:F',
    });
    const rows = response.data.values || [];
    const dataRows = rows.slice(1);
    const indexInData = dataRows.findIndex(row => (row[0] || '').trim() === (userId || '').trim());
    const absoluteIndex = indexInData === -1 ? -1 : indexInData + 1;
    const userRow = absoluteIndex !== -1 ? rows[absoluteIndex] : [];
    const rawPlan = userRow[4];
    const rawProgress = userRow[5];

    const decoded = decodeHtmlEntities(String(rawPlan || ''));
    const betweenBraces = extractJsonObjectFromText(String(rawPlan || ''));
    const parsed1 = parseJsonPossiblyDoubleEncoded(String(rawPlan || ''));
    const planBefore = parsed1 || betweenBraces;
    const planAfter = normalizePlanObjectLoose(normalizeMonthlyPlanKeys(planBefore));

    const diagnostics = {
      header: rows[0] || [],
      absoluteIndex,
      rawPlanLength: rawPlan ? String(rawPlan).length : 0,
      rawPlanPreview: rawPlan ? String(rawPlan).slice(0, 220) : null,
      decodedPreview: decoded ? decoded.slice(0, 220) : null,
      keysBefore: planBefore ? Object.keys(planBefore) : [],
      hasMonthlyPlanArrayBefore: !!(planBefore && (Array.isArray(planBefore.milestones) || Array.isArray(planBefore.monthly_plan))),
      keysAfter: planAfter ? Object.keys(planAfter) : [],
      hasMonthlyPlanArrayAfter: !!(planAfter && (Array.isArray(planAfter.milestones) || Array.isArray(planAfter.monthly_plan))),
      monthlyPlanLength: planAfter && (Array.isArray(planAfter.milestones) ? planAfter.milestones.length : (Array.isArray(planAfter.monthly_plan) ? planAfter.monthly_plan.length : null)),
      hasProgress: !!rawProgress,
    };
    res.json(diagnostics);
  } catch (error) {
    console.error('Milestone debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mark milestone as complete
 */
app.post('/api/milestone-roadmap/:userId/complete', async (req, res) => {
  // Set CORS headers explicitly for this endpoint
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  try {
    const { userId } = req.params;
    const { milestoneNumber } = req.body;
    const milestoneNumberNum = Number(milestoneNumber);
    
    console.log(`Marking milestone ${milestoneNumberNum} as complete for user ${userId}`);
    
    // First, get current data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: MILESTONE_SPREADSHEET_ID,
      range: 'sheet1!A:F',
    });

    const rows = response.data.values || [];
    // Find user row, skipping header
    const userRowIndexInData = rows.slice(1).findIndex(row => (row[0] || '').trim() === (userId || '').trim());
    
    if (userRowIndexInData === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const absoluteRowIndex = userRowIndexInData + 1;

    // Get current progress or create new, with robust parsing
    const rawProgress = rows[absoluteRowIndex] ? rows[absoluteRowIndex][5] : undefined;
    let progress;
    if (rawProgress && typeof rawProgress === 'string' && rawProgress.trim().startsWith('{')) {
        try {
            progress = JSON.parse(rawProgress);
        } catch (e) {
            progress = {}; // Start fresh if JSON is broken
        }
    } else {
        progress = {};
    }

    // Initialize progress object if it's new or broken
    progress = {
      userId,
      currentMilestone: progress.currentMilestone || 0,
      milestonesCompleted: progress.milestonesCompleted || [],
      milestoneProgress: progress.milestoneProgress || {}
    };

    // Normalize arrays to numbers to prevent type errors
    progress.milestonesCompleted = progress.milestonesCompleted.map(Number);
    
    // Add milestone to completed list if not already there
    if (!progress.milestonesCompleted.includes(milestoneNumberNum)) {
      progress.milestonesCompleted.push(milestoneNumberNum);
      progress.milestonesCompleted.sort((a, b) => a - b);
    }
    
    // Update currentMilestone logic: advance to next uncompleted milestone
    const completedMilestones = progress.milestonesCompleted;
    
    // Update current milestone to be the next milestone after the highest completed one
    // Include milestone 0 (Overview) in the logic
    let newCurrentMilestone = 1; // Default to milestone 1
    
    if (completedMilestones.length > 0) {
      // Get all completed milestones including 0
      const allCompleted = completedMilestones.filter(m => m >= 0);
      if (allCompleted.length > 0) {
        // Get the highest completed milestone that's not just the Overview
        const nonZeroCompleted = allCompleted.filter(m => m >= 1);
        if (nonZeroCompleted.length > 0) {
          const maxCompleted = Math.max(...nonZeroCompleted);
          newCurrentMilestone = Math.min(maxCompleted + 1, 10);
        } else {
          // Only Overview (0) is completed, move to milestone 1
          newCurrentMilestone = 1;
        }
      }
    }
    
    progress.currentMilestone = newCurrentMilestone;
    
    // Add completion timestamp
    if (!progress.milestoneProgress[milestoneNumberNum]) {
      progress.milestoneProgress[milestoneNumberNum] = {};
    }
    progress.milestoneProgress[milestoneNumberNum].completed = true;
    progress.milestoneProgress[milestoneNumberNum].completedDate = new Date().toISOString();
    
    // Update the sheet (column F, which is index 5)
    const updateRange = `sheet1!F${absoluteRowIndex + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: MILESTONE_SPREADSHEET_ID,
      range: updateRange,
      valueInputOption: 'RAW',
      resource: {
        values: [[JSON.stringify(progress)]]
      }
    });
    
    res.json({ success: true, progress });
    
  } catch (error) {
    console.error('Error marking milestone complete:', error);
    res.status(500).json({ error: 'Failed to mark milestone complete' });
  }
});

/**
 * Render milestone roadmap widget
 */
app.get('/milestone-roadmap/:userId', async (req, res) => {
  const { userId } = req.params;
  const username = decodeURIComponent(req.query.username || '') || 'Student';
  
  // Remove X-Frame-Options to allow iframe embedding
  res.removeHeader('X-Frame-Options');
  // Don't set any X-Frame-Options at all to avoid conflicts
  
  // Generate the HTML for the milestone roadmap
  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <title>Your Learning Journey</title>
      <link href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Source Sans Pro', sans-serif;
          background: #000;
          color: #FFFFFF;
          padding: 20px;
          min-height: 100vh;
        }
        
        .loading {
          text-align: center;
          padding: 50px;
          color: #A373F8;
        }
        
        .header {
          margin-bottom: 30px;
          padding: 20px;
          background: linear-gradient(135deg, #000 0%, #0a0a0a 100%);
          border-radius: 12px;
          border: 1px solid rgba(163, 115, 248, 0.2);
        }
        
        .header h1 {
          font-size: 16px;
          margin-bottom: 10px;
        }
        
        .north-star {
          color: #F6F8FF;
          font-size: 24px;
          margin-bottom: 15px;
          opacity: 0.9;
        }
        
        .progress-stats {
          display: flex;
          gap: 20px;
          font-size: 14px;
          color: #A373F8;
        }

        .view-toggle {
          color: #A373F8;
          background: rgba(163, 115, 248, 0.15);
          border: 1px solid rgba(163, 115, 248, 0.4);
          border-radius: 6px;
          padding: 6px 12px;
          text-decoration: none;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          font-size: 13px;
        }
        .view-toggle:hover { 
          background: rgba(163, 115, 248, 0.25);
          border-color: rgba(163, 115, 248, 0.6);
          text-decoration: none;
        }
        .view-toggle.active {
          background: rgba(163, 115, 248, 0.15);
          color: #FFFFFF;
          border-color: rgba(163, 115, 248, 0.5);
        }
        .view-toggle.active:hover {
          background: rgba(163, 115, 248, 0.2);
          border-color: rgba(163, 115, 248, 0.6);
        }
        
        .timeline {
          position: relative;
          padding: 20px 0;
          width: 100%;
        }
        
        .timeline-line {
          position: absolute;
          left: 50%;
          top: 0;
          bottom: 0;
          width: 3px;
          background: #A373F8;
          opacity: 0.3;
          transform: translateX(-50%);
        }
        
        .milestone {
          position: relative;
          margin: 30px 0;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 80px;
          width: 100%;
        }
        
        .milestone-dot {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #000;
          border: 3px solid #A373F8;
          z-index: 2;
        }
        
        .milestone.completed .milestone-dot {
          background: #A373F8;
        }
        
        .milestone-content {
          background: rgba(163, 115, 248, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          padding: 15px 20px;
          width: 40%;
          transition: all 0.3s ease;
        }
        .milestone-content.clickable { cursor: pointer; }
        
        .milestone:nth-child(odd) .milestone-content {
          margin-right: auto;
          margin-left: 55%;
        }
        
        .milestone:nth-child(even) .milestone-content {
          margin-left: auto;
          margin-right: 55%;
        }
        
        .milestone-content:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(163, 115, 248, 0.2);
        }
        
        .milestone-title {
          font-weight: 600;
          font-size: 16px;
          margin-bottom: 5px;
        }
        .milestone-meta {
          font-size: 14px;
          opacity: 0.85;
          margin-top: 6px;
        }
        .milestone-meta .label {
          color: #A373F8;
          font-weight: 700;
          margin-right: 6px;
        }
        
        .milestone.completed .milestone-title {
          text-decoration: line-through;
          opacity: 0.7;
        }
        
        .current-indicator {
          text-align: center;
          margin: 20px 0;
          color: #A373F8;
          font-weight: 600;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 2px;
        }
        
        .current-milestone-detail {
          background: rgba(163, 115, 248, 0.15);
          border: 2px solid #A373F8;
          border-radius: 12px;
          padding: 20px;
          margin: 20px auto;
          width: 800px;
          max-width: 100%;
          position: relative;
        }
        
        .milestone-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .current-view-wrap {
          display: block;
          margin: 0 auto;
          max-width: 100%;
        }
        .nav-arrow {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 1px solid rgba(163, 115, 248, 0.4);
          background: rgba(163, 115, 248, 0.15);
          color: #A373F8;
          font-size: 18px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        .nav-arrow:hover { background: rgba(163, 115, 248, 0.25); }
        .nav-arrow:disabled { opacity: 0.4; cursor: not-allowed; }
        
        .current-milestone-detail h2 {
          color: #A373F8;
          font-size: 18px;
          margin-bottom: 20px;
        }
        
        .milestone-section {
          margin: 20px 0;
        }
        
        .milestone-section h3 {
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
          opacity: 0.7;
        }
        
        
        
        .milestone-goal {
          background: rgba(0, 0, 0, 0.5);
          padding: 12px;
          border-radius: 6px;
          border-left: 3px solid #A373F8;
          margin: 10px 0;
        }
        
        .overview-text {
          font-size: 21px;
          line-height: 1.6;
          margin: 20px 0;
        }

        /* Course Progress Styles */
        .course-progress-section {
          background: rgba(163, 115, 248, 0.05);
          border: 1px solid rgba(163, 115, 248, 0.2);
          border-radius: 8px;
          padding: 15px;
          margin: 15px 0;
        }
        
        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        
        .progress-title {
          font-size: 16px;
          font-weight: 600;
          color: #A373F8;
        }
        
        .progress-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: rgba(163, 115, 248, 0.2);
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
        }
        
        .progress-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 10px;
          margin-bottom: 15px;
        }
        
        .stat-card {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(163, 115, 248, 0.3);
          border-radius: 6px;
          padding: 7px;
          text-align: center;
          height: 60px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        
        .stat-icon {
          font-size: 11px;
          margin-bottom: 2px;
        }
        
        .stat-value {
          font-size: 12px;
          font-weight: 700;
          color: #FFFFFF;
          margin-bottom: 1px;
        }
        
        .stat-label {
          font-size: 7px;
          color: #A373F8;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        
        .progress-bar-container {
          position: relative;
          margin-bottom: 15px;
        }
        
        .progress-bar-large {
          height: 24px;
          background: rgba(163, 115, 248, 0.1);
          border-radius: 12px;
          overflow: hidden;
          position: relative;
        }
        
        .progress-bar-fill-large {
          height: 100%;
          background: linear-gradient(90deg, #A373F8 0%, #8b5df6 100%);
          transition: width 0.6s ease;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 10px;
        }
        
        .progress-percentage {
          color: #000;
          font-weight: 700;
          font-size: 12px;
        }
        
        .units-section {
          margin-top: 15px;
        }
        
        .units-header {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 10px;
          color: #A373F8;
        }
        
        .unit-item {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(163, 115, 248, 0.15);
          border-radius: 4px;
          padding: 8px 12px;
          margin-bottom: 6px;
          transition: all 0.2s ease;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .unit-item:hover {
          border-color: rgba(163, 115, 248, 0.3);
        }
        
        .unit-name {
          font-weight: 500;
          color: #FFFFFF;
          flex: 1;
          font-size: 13px;
        }
        
        .unit-score {
          color: #A373F8;
          font-weight: 600;
          font-size: 12px;
          margin-left: 10px;
          min-width: 48px;
          text-align: right;
        }
        
        .unit-status {
          padding: 2px 6px;
          border-radius: 8px;
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          margin-left: 8px;
        }
        
        .unit-status.completed {
          background: rgba(76, 175, 80, 0.2);
          color: #4CAF50;
        }
        
        .unit-status.in-progress {
          background: rgba(255, 193, 7, 0.2);
          color: #FFC107;
        }
        
        .unit-status.not-started {
          background: rgba(158, 158, 158, 0.2);
          color: #9E9E9E;
        }
        

        
        .achievement-banner {
          background: linear-gradient(135deg, rgba(163, 115, 248, 0.2) 0%, rgba(139, 93, 246, 0.2) 100%);
          border: 2px solid #A373F8;
          border-radius: 8px;
          padding: 12px;
          text-align: center;
          margin: 12px 0;
        }
        
        .achievement-icon {
          font-size: 24px;
          margin-bottom: 6px;
        }
        
        .achievement-text {
          font-size: 14px;
          font-weight: 600;
          color: #FFFFFF;
        }
        
        .loading-skeleton {
          background: linear-gradient(90deg, rgba(163, 115, 248, 0.1) 25%, rgba(163, 115, 248, 0.2) 50%, rgba(163, 115, 248, 0.1) 75%);
          background-size: 200% 100%;
          animation: loading 1.5s infinite;
          border-radius: 8px;
          height: 20px;
          margin: 10px 0;
        }
        
        @keyframes loading {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        
        
        
        .course-recommendation {
          background: rgba(163, 115, 248, 0.1);
          border: 1px solid rgba(163, 115, 248, 0.3);
          padding: 12px;
          border-radius: 6px;
          margin-top: 12px;
        }
        .course-recommendation-link {
          text-decoration: none;
          color: inherit;
          display: block;
        }

        
        .course-link {
          color: #A373F8;
          text-decoration: none;
          font-weight: 600;
          display: inline-block;
          margin-top: 10px;
        }
        
        .course-link:hover {
          text-decoration: underline;
        }
        
        @media (max-width: 768px) {
          .timeline-line {
            left: 30px;
          }
          
          .milestone-dot {
            left: 30px;
          }
          
          .milestone-content {
            width: calc(100% - 60px);
            margin-left: 60px !important;
            margin-right: 0 !important;
          }
        }
      </style>
    </head>
    <body>
      <div id="app">
        <div class="loading">Loading your learning journey...</div>
      </div>
      
      <script>
        const userId = '${userId}';
        const username = '${username.replace(/'/g, "\\'")}';
        const apiBaseUrl = window.location.origin;
        
        async function loadRoadmap() {
          try {
            const url = apiBaseUrl + '/api/milestone-roadmap/' + userId;
            console.log('[Client] Fetching milestone data from:', url);
            const response = await fetch(url);
            console.log('[Client] Response status:', response.status);
            const data = await response.json();
            console.log('[Client] Response JSON keys:', Object.keys(data || {}));
            if (data && data.roadmapPlan) {
              console.log('[Client] roadmapPlan present. milestones length:', Array.isArray(data.roadmapPlan.milestones) ? data.roadmapPlan.milestones.length : 'n/a');
            } else {
              console.log('[Client] No roadmapPlan in response');
            }
            
            if (!response.ok) {
              throw new Error(data.error || 'Failed to load roadmap');
            }
            
            renderRoadmap(data);
            // Ensure iframe resizes after initial render
            sendHeight();
            setTimeout(sendHeight, 300);
            setTimeout(sendHeight, 800);
          } catch (error) {
            console.error('Error loading roadmap:', error);
            document.getElementById('app').innerHTML = '<div class="loading">Error loading roadmap. Please refresh the page.</div>';
            sendHeight();
          }
        }
        
        function renderRoadmap(data) {
          let { roadmapPlan, roadmapProgress, planState } = data;
          console.log('[Client] renderRoadmap called with planState:', planState);
          
          // Handle backward compatibility: convert old keys to new keys
          if (roadmapPlan) {
            // Convert monthly_plan to milestones if needed
            if (roadmapPlan.monthly_plan && !roadmapPlan.milestones) {
              roadmapPlan.milestones = roadmapPlan.monthly_plan;
            }
            // Convert quarterly_summary to quarters if needed  
            if (roadmapPlan.quarterly_summary && !roadmapPlan.quarters) {
              roadmapPlan.quarters = roadmapPlan.quarterly_summary;
            }
            // Convert quarters to halves if needed
            if (roadmapPlan.quarters && !roadmapPlan.halves) {
              roadmapPlan.halves = roadmapPlan.quarters;
            }
          }
          
          // Handle different plan states
          if (planState === 'none' || !roadmapPlan || !roadmapPlan.milestones) {
            document.getElementById('app').innerHTML = 
              '<div class="loading" style="text-align: center; padding: 60px 20px; min-height: 400px; display: flex; flex-direction: column; justify-content: center; align-items: center;">' +
                '<h3 style="color: #A373F8; margin-bottom: 20px; font-size: 24px;">No roadmap found!</h3>' +
                '<p style="color: #FFFFFF; line-height: 1.6; margin-bottom: 20px; max-width: 500px;">If you\\\'ve just filled out our onboarding form, our system is hard at work making a personalized plan to help you reach your musical goals. This page will automatically reload in 5 minutes to check for your new plan.</p>' +
                '<p style="color: #FFFFFF; line-height: 1.6; margin-bottom: 20px; max-width: 500px;">If you never filled out the form, <a href="https://learn.futureproofmusicschool.com/standalone-form?assessment-id=68b0a35a9f293e250a0cf3e4" target="_top" style="color: #A373F8; text-decoration: underline;">please take a minute to fill out the questions on our onboarding form</a> and we\\\'ll generate a custom plan for you.</p>' +
              '</div>';
            setupAutoReload();
            sendHeight();
            return;
          }
          
          if (planState === 'inprogress') {
            document.getElementById('app').innerHTML = 
              '<div class="loading" style="text-align: center; padding: 60px 20px; min-height: 400px; display: flex; flex-direction: column; justify-content: center; align-items: center;">' +
                '<h3 style="color: #A373F8; margin-bottom: 20px; font-size: 24px;">Building Your Custom Plan</h3>' +
                '<p style="color: #FFFFFF; line-height: 1.6; margin-bottom: 30px; max-width: 500px;">Our system is currently building your personalized curriculum plan and it should be ready in five minutes or less. Please have a look around our site while our system does a little research and builds your custom plan.</p>' +
                '<div style="margin-top: 20px;">' +
                  '<div style="display: inline-block; width: 30px; height: 30px; border: 3px solid rgba(163, 115, 248, 0.3); border-top: 3px solid #A373F8; border-radius: 50%; animation: spin 1s linear infinite;"></div>' +
                '</div>' +
              '</div>';
            
            // Set up auto-reload after 5 minutes of inactivity
            setupAutoReload();
            sendHeight();
            return;
          }
          
              const progress = roadmapProgress || {
      currentMilestone: 1,
      milestonesCompleted: [],
      milestoneProgress: {}
    };
          
          // Recompute current milestone based on completed milestones to ensure consistency
          const completed = progress.milestonesCompleted || [];
          let currentMilestone = progress.currentMilestone || 1;
          
          // If we have completed milestones, ensure current is set correctly
          if (completed.length > 0) {
            const maxCompleted = Math.max(...completed);
            currentMilestone = Math.min(maxCompleted + 1, 10);
          } else if (!progress.currentMilestone) {
            // If no progress at all, start at 1
            currentMilestone = 1;
          }
          
          console.log('[Client] Progress loaded:', { 
            currentMilestone, 
            completed, 
            originalCurrent: progress.currentMilestone 
          });

          // Expose data for client-side interactions (e.g., clicking milestones)
          window.ROADMAP_PLAN = roadmapPlan;
          window.ROADMAP_PROGRESS = progress;
          window.CURRENT_MILESTONE = currentMilestone;
          
          let html = '<div class="header">' +
            '<h1 style="font-weight: 400;">Welcome back, ' + username + '!</h1>' +
            '<div class="north-star">Goal: ' + roadmapPlan.northstar + '</div>' +
            '<div class="progress-stats">' +
              '<a href="#" onclick="showCurrentMilestone(event)" id="current-link" class="view-toggle active">🎯 ' + (currentMilestone === 0 ? 'Overview' : 'Current Milestone: ' + currentMilestone + ' of 10') + '</a>' +
              '<a id="path-link" class="view-toggle" href="#" onclick="showPathView(event)">🧭 My Path</a>' +
            '</div>' +
            '</div>';

          // Move the current milestone detail ABOVE the timeline
          // Handle Milestone 0 (Overview) differently
          if (currentMilestone === 0) {
            html += '<div id="current-view-wrap" class="current-view-wrap">' +
              '<div id="current-view" class="current-milestone-detail" style="cursor: pointer;" onclick="showMilestoneDetail(1)">' +
              '<div class="milestone-nav">' +
                '<h2 style="margin: 0;">OVERVIEW</h2>' +
              '</div>' +
              '<div class="overview-text">' + roadmapPlan.overview.replace(/[.] /g, '.<br><br>') + '</div>' +
              '<div class="milestone-section">' +
                '<div style="background: rgba(163, 115, 248, 0.1); border: 1px solid rgba(163, 115, 248, 0.3); padding: 15px; border-radius: 8px; text-align: center;">' +
                  '<div style="color: #A373F8; font-weight: 600; margin-bottom: 10px;">Ready to begin your journey?</div>' +
                  '<div style="font-size: 14px; margin-bottom: 15px;">Click to start with Milestone 1 of your personalized learning plan.</div>' +
                '</div>' +
              '</div>' +
              '</div>' +
              '</div>';
          } else {
            const currentMilestoneData = roadmapPlan.milestones[currentMilestone - 1];
            if (currentMilestoneData) {
            html += '<div id="current-view-wrap" class="current-view-wrap">' +
              '<div id="current-view" class="current-milestone-detail">' +
              '<div class="milestone-nav">' +
                '<h2 style="margin: 0;">MILESTONE ' + currentMilestone + ': ' + currentMilestoneData.focus + '</h2>' +
              '</div>' +
              '';
            
            if (currentMilestoneData.course_rec) {
              html += '<div class="milestone-section">' +
                '<h3>COURSE</h3>' +
                '<div class="course-recommendation">' +
                  '<a href="' + currentMilestoneData.course_rec.url + '" class="course-recommendation-link">' +
                    '<div style="font-weight: 600; margin-bottom: 8px;">' + currentMilestoneData.course_rec.title + '</div>' +
                    '<div style="margin-bottom: 8px; font-size: 14px; opacity: 0.9;">' + currentMilestoneData.course_rec.benefit + '</div>' +
                    '<div id="rec-cta" class="rec-cta" style="color:#A373F8; font-weight:700;">Go to Course →</div>' +
                  '</a>' +
                '</div>' +
                '</div>';
            }
            
            // Add course progress section placeholder
            html += '<div id="course-progress-container"></div>';
            
            html += '<div class="milestone-section">' +
                '<div class="milestone-goal">' +
                  '<h3>GOAL</h3>' +
                  (currentMilestoneData.goal || currentMilestoneData.milestone) +
                '</div>' +
              '</div>' +
              '</div>' +
              '</div>';
            }
          }

          html += '<div id="path-view" style="display:none; background: rgba(0,0,0,1); padding: 20px;"><div class="timeline">' +
              '<div class="timeline-line"></div>';
          
          // Render timeline
          console.log('[Client] About to render timeline. milestones length:', roadmapPlan.milestones ? roadmapPlan.milestones.length : 'undefined');
          
          // Add Milestone 0 (Overview) to timeline
          const isOverviewCompleted = completed.includes(0);
          const isOverviewCurrent = currentMilestone === 0;
          html += '<div class="milestone ' + (isOverviewCompleted ? 'completed' : '') + ' ' + (isOverviewCurrent ? 'current' : '') + '">' +
            '<div class="milestone-dot"></div>' +
            '<div class="milestone-content clickable" onclick="showMilestoneDetail(0)">' +
              '<div class="milestone-title">' +
                (isOverviewCompleted ? '✅' : (isOverviewCurrent ? '🎯' : '📖')) + ' ' +
                'Overview: Getting Started' +
              '</div>' +
              '<div class="milestone-meta" style="margin-top: 8px; font-size: 13px; line-height: 1.4;">' + roadmapPlan.overview + '</div>' +
            '</div>' +
          '</div>';
          
          if (roadmapPlan.milestones && Array.isArray(roadmapPlan.milestones)) {
            roadmapPlan.milestones.forEach((milestone, index) => {
              const num = index + 1;
              const isCompleted = completed.includes(num);
              const isCurrent = num === currentMilestone;
              
              console.log('[Client] Rendering milestone', num, 'focus:', milestone.focus);
              
              html += '<div class="milestone ' + (isCompleted ? 'completed' : '') + ' ' + (isCurrent ? 'current' : '') + '">' +
                '<div class="milestone-dot"></div>' +
                '<div class="milestone-content clickable" onclick="showMilestoneDetail(' + num + ')">' +
                  '<div class="milestone-title">' +
                    (isCompleted ? '✅' : (isCurrent ? '🎯' : '🔒')) + ' ' +
                    'Milestone ' + num + ': ' + (milestone.focus || 'No Focus') +
                  '</div>' +
                  (milestone && milestone.course_rec && milestone.course_rec.title
                    ? '<div class="milestone-meta"><span class="label">Recommended:</span> ' + milestone.course_rec.title + '</div>'
                    : '') +
                  (milestone && (milestone.goal || milestone.milestone)
                    ? '<div class="milestone-meta"><span class="label">Goal:</span> ' + (milestone.goal || milestone.milestone) + '</div>'
                    : '') +
                '</div>' +
              '</div>';
            });
          } else {
            console.log('[Client] No milestones found or not an array');
            html += '<div style="color: #A373F8; text-align: center; padding: 50px;">No milestones found. Please complete your onboarding form.</div>';
          }
          
          html += '</div></div>';
          
          document.getElementById('app').innerHTML = html;
          // Hydrate recommendation progress (if any) - only for regular milestones, not Overview
          if (currentMilestone > 0) {
            const currentMilestoneData = roadmapPlan.milestones[currentMilestone - 1];
            if (currentMilestoneData && currentMilestoneData.course_rec) {
              hydrateRecommendationProgress(currentMilestoneData.course_rec, currentMilestone);
            }
          }
          // Initialize nav arrows state
          window.DISPLAYED_MILESTONE = currentMilestone;
          updateNavArrows();
          // Resize after DOM update
          sendHeight();
        }

        function updateNavArrows() {
          try {
            const plan = window.ROADMAP_PLAN;
            const total = Array.isArray(plan?.milestones) ? plan.milestones.length : 10;
            const current = Number(window.DISPLAYED_MILESTONE || 0);
            const prevBtn = document.getElementById('nav-prev');
            const nextBtn = document.getElementById('nav-next');
            if (prevBtn) prevBtn.disabled = current <= 0;
            if (nextBtn) nextBtn.disabled = current >= total;
          } catch (_) {}
        }

        function navigateMilestone(direction) {
          const plan = window.ROADMAP_PLAN;
          if (!plan) return;
          const total = Array.isArray(plan.milestones) ? plan.milestones.length : 10;
          const current = Number(window.DISPLAYED_MILESTONE || window.CURRENT_MILESTONE || 0);
          let next = current + Number(direction || 0);
          if (next < 0) next = 0;
          if (next > total) next = total;
          if (next !== current) {
            showMilestoneDetail(next);
          }
        }
        
        // Update the current milestone button text
        function updateCurrentMilestoneButton() {
          const currentLink = document.getElementById('current-link');
          const currentMilestone = window.CURRENT_MILESTONE || 0;
          
          if (currentLink) {
            const buttonText = currentMilestone === 0 ? '🎯 Overview' : '🎯 Current Milestone: ' + currentMilestone + ' of 10';
            currentLink.innerHTML = buttonText;
          }
        }

        // Show the details for a selected milestone and return to the detail view
        function showMilestoneDetail(milestoneNumber) {
          // Always attempt to scroll to top in iframe immediately
          try { window.scrollTo(0, 0); } catch (_) {}
          const plan = window.ROADMAP_PLAN;
          const progress = window.ROADMAP_PROGRESS || { currentMilestone: 0 };
          if (!plan) return;
          
          // Handle Milestone 0 (Overview) separately
          if (Number(milestoneNumber) === 0) {
            const currentEl = document.getElementById('current-view');
            if (currentEl) {
              let inner = '' +
                '<div class="milestone-nav">' +
                  '<h2 style="margin: 0;">OVERVIEW</h2>' +
                '</div>' +
                '<div class="overview-text">' + plan.overview.replace(/[.] /g, '.<br><br>') + '</div>' +
                '<div class="milestone-section">' +
                  '<div style="background: rgba(163, 115, 248, 0.1); border: 1px solid rgba(163, 115, 248, 0.3); padding: 15px; border-radius: 8px; text-align: center;">' +
                    '<div style="color: #A373F8; font-weight: 600; margin-bottom: 10px;">Ready to begin your journey?</div>' +
                    '<div style="font-size: 14px; margin-bottom: 15px;">Click to start with Milestone 1 of your personalized learning plan.</div>' +
                  '</div>' +
                '</div>';
              currentEl.innerHTML = inner;
              currentEl.style.cursor = 'pointer';
              currentEl.onclick = () => showMilestoneDetail(1);
            }
            
            // Track currently displayed milestone
            window.DISPLAYED_MILESTONE = 0;
            
            // Auto-complete Overview on first view
            markMilestoneComplete(0);
            
                      // Switch back to detail view
          const path = document.getElementById('path-view');
          const wrap = document.getElementById('current-view-wrap');
          if (path) path.style.display = 'none';
          if (wrap) wrap.style.display = '';
          
          // Update active button states when switching to detail view
          const currentLink = document.getElementById('current-link');
          const pathLink = document.getElementById('path-link');
          if (currentLink) currentLink.classList.add('active');
          if (pathLink) pathLink.classList.remove('active');
          
          // Update button text to reflect current milestone
          updateCurrentMilestoneButton();
          
          requestParentScrollTop();
          setTimeout(requestParentScrollTop, 60);
          try { setTimeout(function(){ window.scrollTo(0, 0); }, 30); } catch(_) {}
          sendHeight();
          setTimeout(sendHeight, 200);
          setTimeout(sendHeight, 800);
            return;
          }
          
          // Handle regular milestones
          if (!Array.isArray(plan.milestones)) return;
          const idx = Number(milestoneNumber) - 1;
          const data = plan.milestones[idx];
          if (!data) return;

          const isCurrent = Number(milestoneNumber) === Number(progress.currentMilestone);
          const currentEl = document.getElementById('current-view');
          if (currentEl) {
            let inner = '' +
              '<div class="milestone-nav">' +
                '<h2 style="margin: 0;">MILESTONE ' + milestoneNumber + ': ' + data.focus + '</h2>' +
              '</div>' +
              '';
            
            if (data.course_rec) {
              inner += '<div class="milestone-section">' +
                '<h3>COURSE</h3>' +
                '<div class="course-recommendation">' +
                  '<a href="' + data.course_rec.url + '" class="course-recommendation-link">' +
                    '<div style="font-weight: 600; margin-bottom: 8px;">' + data.course_rec.title + '</div>' +
                    '<div style="margin-bottom: 8px; font-size: 14px; opacity: 0.9;">' + data.course_rec.benefit + '</div>' +
                    '<div id="rec-cta" class="rec-cta" style="color:#A373F8; font-weight:700;">Go to Course →</div>' +
                  '</a>' +
                '</div>' +
                '</div>';
            }
            
            // Add course progress section placeholder
            inner += '<div id="course-progress-container"></div>';
            
            inner += '<div class="milestone-section">' +
                '<div class="milestone-goal">' +
                  '<h3>GOAL</h3>' +
                  (data.goal || data.milestone || '') +
                '</div>' +
              '</div>' +
              '';

            currentEl.innerHTML = inner;
            currentEl.style.cursor = 'default';
            currentEl.onclick = null;
          }

          // Track currently displayed milestone
          window.DISPLAYED_MILESTONE = Number(milestoneNumber);

          // Switch back to detail view
          const path = document.getElementById('path-view');
          const wrap = document.getElementById('current-view-wrap');
          if (path) path.style.display = 'none';
          if (wrap) wrap.style.display = '';

          // Update active button states when switching to detail view
          const currentLink = document.getElementById('current-link');
          const pathLink = document.getElementById('path-link');
          if (currentLink) currentLink.classList.add('active');
          if (pathLink) pathLink.classList.remove('active');

          // Update button text to reflect current milestone
          updateCurrentMilestoneButton();

          // Hydrate recommendation progress for the selected milestone
          if (data && data.course_rec) {
            hydrateRecommendationProgress(data.course_rec, milestoneNumber);
          }
          // Ask parent page to scroll the iframe into view
          requestParentScrollTop();
          setTimeout(requestParentScrollTop, 60);
          // Also attempt another iframe scroll after layout settles
          try { setTimeout(function(){ window.scrollTo(0, 0); }, 30); } catch(_) {}
          sendHeight();
          setTimeout(sendHeight, 200);
          setTimeout(sendHeight, 800);
        }

        async function hydrateRecommendationProgress(courseRec, milestoneNumber) {
          try {
            if (!courseRec || !courseRec.url) return;
            // Extract course ID exactly as used in SAMPLEPLAN and roadmap links
            // Format: https://learn.futureproofmusicschool.com/path-player?courseid=XYZ
            const match = courseRec.url.match(/courseid=([^&#]+)/);
            const courseId = match ? match[1] : null;
            if (!courseId) return;

            // Show loading skeleton
            const progressContainer = document.getElementById('course-progress-container');
            if (progressContainer) {
              progressContainer.innerHTML = '<div class="loading-skeleton"></div><div class="loading-skeleton"></div>';
            }

            // Call our single-course progress endpoint that proxies LearnWorlds per-course API
            const resp = await fetch(apiBaseUrl + '/api/course-progress/' + userId + '/course/' + courseId);
            const data = await resp.json();
            if (!resp.ok || !data) {
              if (progressContainer) progressContainer.innerHTML = '';
              return;
            }
            
            // Check if course is completed and milestone is not yet marked as complete
            if (data.status === 'completed' && milestoneNumber) {
              const progress = window.ROADMAP_PROGRESS || {};
              const completedMilestones = progress.milestonesCompleted || [];
              
              // If this milestone isn't already marked as complete, mark it now
              if (!completedMilestones.includes(Number(milestoneNumber))) {
                console.log('Course completed! Marking milestone', milestoneNumber, 'as complete');
                await markMilestoneComplete(milestoneNumber);
                
                // If we just completed the currently displayed milestone, we might want to show a celebration
                if (Number(milestoneNumber) === Number(window.DISPLAYED_MILESTONE)) {
                  // The celebration banner is already shown in renderCourseProgress
                  console.log('Current milestone completed!');
                }
              }
            }
            
            // Render detailed progress section
            if (progressContainer && data.progress_rate !== undefined) {
              progressContainer.innerHTML = renderCourseProgress(data);
            }
            
            // Call sendHeight multiple times with increasing delays to ensure
            // the dynamic content (assessments/quizzes) is properly measured
            sendHeight();
            setTimeout(sendHeight, 100);
            setTimeout(sendHeight, 300);
            setTimeout(sendHeight, 600);
          } catch (e) {
            console.error('Error loading course progress:', e);
            const progressContainer = document.getElementById('course-progress-container');
            if (progressContainer) progressContainer.innerHTML = '';
          }
        }
        
        // New function to mark milestone as complete
        async function markMilestoneComplete(milestoneNumber) {
          try {
            // Check if milestone is already completed
            const progress = window.ROADMAP_PROGRESS || { milestonesCompleted: [] };
            if (progress.milestonesCompleted && progress.milestonesCompleted.includes(Number(milestoneNumber))) {
              console.log('Milestone', milestoneNumber, 'already completed');
              return; // Already completed, no need to mark again
            }
            
            const response = await fetch(apiBaseUrl + '/api/milestone-roadmap/' + userId + '/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ milestoneNumber: Number(milestoneNumber) })
            });
            
            if (response.ok) {
              const result = await response.json();
              // Update local progress data
              window.ROADMAP_PROGRESS = result.progress;
              window.CURRENT_MILESTONE = result.progress.currentMilestone;
              
              // Update button text to reflect new current milestone
              updateCurrentMilestoneButton();
              
              // Refresh the timeline view to show the completed status
              // Note: index 0 is Overview, so actual milestone N is at index N
              const milestoneElements = document.querySelectorAll('.milestone');
              milestoneElements.forEach((el, index) => {
                // Milestone 0 is Overview, Milestone 1 is at index 1, etc.
                if (index === Number(milestoneNumber)) {
                  el.classList.add('completed');
                  const title = el.querySelector('.milestone-title');
                  if (title && !title.innerHTML.includes('✅')) {
                    // Replace the first emoji/icon with checkmark
                    title.innerHTML = title.innerHTML.replace(/^[🎯🔒📖✅]/, '✅');
                  }
                }
              });
              
              console.log('Milestone', milestoneNumber, 'marked as complete');
            }
          } catch (error) {
            console.error('Error marking milestone complete:', error);
          }
        }
        
        function renderCourseProgress(data) {
          if (!data) return '';
          
          const progressRate = Math.round(data.progress_rate || 0);
          const averageScore = Math.round(data.average_score_rate || 0);
          const timeOnCourse = data.time_on_course || 0;
          const totalUnits = data.total_units || 0;
          const completedUnits = data.completed_units || 0;
          const status = data.status || 'not_started';
          
          // Convert seconds to readable format
          const hours = Math.floor(timeOnCourse / 3600);
          const minutes = Math.floor((timeOnCourse % 3600) / 60);
          const timeDisplay = hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
          
          // Determine status badge
          let statusBadge = '';
          let statusIcon = '';
          if (status === 'completed') {
            statusBadge = '<span class="progress-badge" style="background: rgba(76, 175, 80, 0.2); color: #4CAF50;">✅ Completed</span>';
            statusIcon = '🏆';
          } else if (progressRate > 0) {
            statusBadge = '<span class="progress-badge">🚀 In Progress</span>';
            statusIcon = '📚';
          } else {
            statusBadge = '<span class="progress-badge" style="background: rgba(158, 158, 158, 0.2); color: #9E9E9E;">Not Started</span>';
            statusIcon = '📖';
          }
          
          // Get the course URL from the current displayed milestone
          let courseUrl = '';
          const displayedMilestone = window.DISPLAYED_MILESTONE;
          if (displayedMilestone > 0 && window.ROADMAP_PLAN && window.ROADMAP_PLAN.milestones) {
            const milestoneData = window.ROADMAP_PLAN.milestones[displayedMilestone - 1];
            if (milestoneData && milestoneData.course_rec && milestoneData.course_rec.url) {
              courseUrl = milestoneData.course_rec.url;
            }
          }
          
          // Make the entire section clickable if we have a course URL
          let html = courseUrl 
            ? '<a href="' + courseUrl + '" style="text-decoration: none; color: inherit; display: block;"><div class="course-progress-section" style="cursor: pointer; transition: all 0.3s ease;" onmouseover="this.style.transform=\\'translateY(-2px)\\'; this.style.boxShadow=\\'0 4px 12px rgba(163, 115, 248, 0.2)\\';" onmouseout="this.style.transform=\\'\\'; this.style.boxShadow=\\'\\';">'
            : '<div class="course-progress-section">';
          
          // Header
          html += '<div class="progress-header">' +
            '<div class="progress-title">Course Progress</div>' +
            statusBadge +
            '</div>';
          
          // Achievement banner for completed courses
          if (status === 'completed') {
            html += '<div class="achievement-banner">' +
              '<div class="achievement-icon">🎉</div>' +
              '<div class="achievement-text">Congratulations! You\\\'ve completed this course!</div>' +
              '<div style="margin-top: 15px;">' +
                '<div style="color: #A373F8; font-weight: 600; margin-bottom: 10px;">Ready for the next milestone?</div>' +
                '<button onclick="event.stopPropagation(); event.preventDefault(); advanceToNextMilestone(); return false;" style="background: #A373F8; color: #000; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;">Continue to Next Milestone →</button>' +
              '</div>' +
              '</div>';
          }
          
          // Main progress bar
          html += '<div class="progress-bar-container">' +
            '<div class="progress-bar-large">' +
              '<div class="progress-bar-fill-large" style="width: ' + progressRate + '%;">' +
                (progressRate > 10 ? '<span class="progress-percentage">' + progressRate + '%</span>' : '') +
              '</div>' +
            '</div>' +
            '</div>';
          
          // Removed stat tiles (Progress, Avg Score, Lessons)
          
          // Assessments breakdown (quizzes and projects only)
          if (data.progress_per_section_unit && data.progress_per_section_unit.length > 0) {
            // First, collect all assessment units
            let assessmentUnits = [];
            data.progress_per_section_unit.forEach(function(section) {
              if (section.units && section.units.length > 0) {
                section.units.forEach(function(unit) {
                  // Only include assessment-type units
                  const nameLc = (unit.unit_name || '').toLowerCase();
                  const typeLc = (unit.unit_type || '').toLowerCase();
                  const isAssessmentType = ['assessment','quiz','project','exam','test'].includes(typeLc);
                  const looksLikeAssessment = nameLc.includes('quiz') || nameLc.includes('assessment') || nameLc.includes('project') || nameLc.includes('exam') || nameLc.includes('test');
                  if (isAssessmentType || looksLikeAssessment) {
                    // Minimal debug for visibility during integration
                    try { console.log('[Progress] Unit candidate:', { name: unit.unit_name, type: unit.unit_type, status: unit.unit_status, score: unit.score_on_unit }); } catch(_) {}
                    assessmentUnits.push(unit);
                  }
                });
              }
            });
            
            // Only show the section if we have assessments
            if (assessmentUnits.length > 0) {
              html += '<div class="units-section">' +
                '<div class="units-header">📝 Quizzes and Projects</div>';
              
              assessmentUnits.forEach(function(unit) {
                const unitProgress = unit.unit_progress_rate || 0;
                const unitStatus = unit.unit_status || 'not_started';
                // According to LW API, per-unit score is score_on_unit
                let unitScore = (unit.score_on_unit);
                if (unitScore !== undefined && unitScore !== null) {
                  const parsed = Number(unitScore);
                  unitScore = Number.isFinite(parsed) ? Math.round(parsed) : null;
                }
                const unitTime = unit.time_on_unit || 0;
                const unitDuration = unit.unit_duration || 0;
                
                // Determine status class
                let statusClass = 'not-started';
                let statusText = 'Not Started';
                if (unitStatus === 'completed') {
                  statusClass = 'completed';
                  statusText = 'Completed';
                } else if (unitProgress > 0) {
                  statusClass = 'in-progress';
                  statusText = 'In Progress';
                }
                
                // Format time
                const unitMinutes = Math.floor(unitTime / 60);
                const durationMinutes = Math.floor(unitDuration / 60);
                
                html += '<div class="unit-item">' +
                  '<div class="unit-name">' + (unit.unit_name || 'Untitled Assessment') + '</div>' +
                  '<div style="display: flex; align-items: center; gap: 10px;">' +
                  '<div class="unit-status ' + statusClass + '">' + statusText + '</div>';
                
                if (unitStatus === 'completed' && unitScore !== null && unitScore !== undefined) {
                  html += '<div class="unit-score">' + unitScore + '%</div>';
                }
                
                html += '</div>' +
                  '</div>';
              });
              
              html += '</div>';
            }
          }
          
          // Close the wrapper (either just div or anchor + div)
          html += courseUrl ? '</div></a>' : '</div>';
          
          return html;
        }
        
        

        // Show the current milestone view
        function showCurrentMilestone(event) {
          if (event) event.preventDefault();
          const currentMilestone = window.CURRENT_MILESTONE || 0;
          
          // Update active button states
          const currentLink = document.getElementById('current-link');
          const pathLink = document.getElementById('path-link');
          if (currentLink) currentLink.classList.add('active');
          if (pathLink) pathLink.classList.remove('active');
          
          showMilestoneDetail(currentMilestone);
        }
        
        // Advance to next milestone (called from course completion)
        function advanceToNextMilestone() {
          const plan = window.ROADMAP_PLAN;
          if (!plan) return;
          
          // Use the currently displayed milestone, not the user's progress milestone
          const displayedMilestone = window.DISPLAYED_MILESTONE || 0;
          const totalMilestones = Array.isArray(plan.milestones) ? plan.milestones.length : 10;
          
          if (displayedMilestone < totalMilestones) {
            const nextMilestone = displayedMilestone + 1;
            showMilestoneDetail(nextMilestone);
          } else {
            // User has completed all milestones!
            console.log('Congratulations! All milestones completed!');
            // Could show a special completion message here
          }
        }
        
        // Show the full path view
        function showPathView(event) {
          if (event) event.preventDefault();
          
          // Update active button states
          const currentLink = document.getElementById('current-link');
          const pathLink = document.getElementById('path-link');
          if (currentLink) currentLink.classList.remove('active');
          if (pathLink) pathLink.classList.add('active');
          
          const current = document.getElementById('current-view-wrap');
          const path = document.getElementById('path-view');
          if (current) current.style.display = 'none';
          if (path) path.style.display = '';
          sendHeight();
          setTimeout(sendHeight, 200);
          setTimeout(sendHeight, 800);
        }
        
        // No string parsing of practices; renderer expects structured objects.

        // Handle click on "No roadmap found" message
        function handleNoRoadmapClick() {
          // Reload the page and navigate to the onboarding form
          window.top.location.href = 'https://learn.futureproofmusicschool.com/standalone-form?assessment-id=68b0a35a9f293e250a0cf3e4';
        }
        
        // Auto-reload functionality for 'inprogress' state
        let autoReloadTimer = null;
        
        function setupAutoReload() {
          // Clear any existing timer
          if (autoReloadTimer) {
            clearTimeout(autoReloadTimer);
          }
          
          // Set up the auto-reload timer (5 minutes = 300000ms)
          autoReloadTimer = setTimeout(() => {
            console.log('[Client] Auto-reloading to check for plan.');
            loadRoadmap();
          }, 300000); // 5 minutes
        }

        // Load roadmap on page load
        loadRoadmap();

        // Send height to parent so the iframe expands to fit content
        function sendHeight() {
          try {
            // Use a more precise calculation that ensures all content is visible
            const appEl = document.getElementById('app');
            const currentViewEl = document.getElementById('current-view-wrap');
            const pathViewEl = document.getElementById('path-view');
            
            let contentHeight = 0;
            
            // Calculate based on which view is currently displayed
            if (currentViewEl && currentViewEl.style.display !== 'none') {
              // Include both the header and the current view content
              const headerEl = document.querySelector('.header');
              const headerHeight = headerEl ? headerEl.offsetHeight : 0;
              
              // Also check for dynamic progress container that might have loaded
              const progressContainer = document.getElementById('course-progress-container');
              const progressHeight = progressContainer ? progressContainer.scrollHeight : 0;
              
              contentHeight = headerHeight + currentViewEl.scrollHeight + progressHeight;
            } else if (pathViewEl && pathViewEl.style.display !== 'none') {
              // For path view, include header + path content
              const headerEl = document.querySelector('.header');
              const headerHeight = headerEl ? headerEl.offsetHeight : 0;
              contentHeight = headerHeight + pathViewEl.scrollHeight;
            } else if (appEl) {
              // Fallback to full app height
              contentHeight = appEl.scrollHeight;
            }
            
            // Add generous padding and use higher minimum to ensure content isn't cut off
            const totalHeight = Math.max(contentHeight + 80, 400);
            
            console.log('Milestone widget sending height:', totalHeight, {
              currentViewHeight: currentViewEl ? currentViewEl.scrollHeight : 0,
              pathViewHeight: pathViewEl ? pathViewEl.scrollHeight : 0,
              appHeight: appEl ? appEl.scrollHeight : 0,
              headerHeight: document.querySelector('.header') ? document.querySelector('.header').offsetHeight : 0,
              progressContainerHeight: document.getElementById('course-progress-container') ? document.getElementById('course-progress-container').scrollHeight : 0,
              currentViewVisible: currentViewEl ? currentViewEl.style.display !== 'none' : false,
              pathViewVisible: pathViewEl ? pathViewEl.style.display !== 'none' : false,
              calculatedContentHeight: contentHeight
            });
            
            window.parent.postMessage({ type: 'resize', height: totalHeight }, '*');
          } catch (e) {
            console.error('Error in sendHeight:', e);
          }
        }
        // Ask parent page to scroll to the top of the widget
        function requestParentScrollTop() {
          try {
            window.parent.postMessage({ type: 'scrollToTop' }, '*');
          } catch (e) {
            // no-op
          }
        }
        window.addEventListener('resize', () => {
          sendHeight();
        });
      </script>
    </body>
  </html>
  `;
  
  res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
