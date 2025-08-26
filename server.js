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
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;  // Course/legacy spreadsheet (Sheet1/Sheet2)
const MILESTONE_SPREADSHEET_ID = process.env.MILESTONE_SPREADSHEET_ID || SPREADSHEET_ID; // Milestone plan spreadsheet (sheet1 with A-F headers)
const sortOrderCache = {
  data: null,
  lastFetch: 0,
  expiryTime: 1000 * 60 * 5 // Cache for 5 minutes (reduced from 1 hour)
};

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
  if (typeof obj.monthly_plan === 'string') {
    try {
      const parsed = JSON.parse(obj.monthly_plan);
      if (Array.isArray(parsed)) obj.monthly_plan = parsed;
    } catch (_) {}
  }
  if (Array.isArray(obj.monthly_plan)) return obj;
  if (Array.isArray(obj.monthlyPlan)) {
    return { ...obj, monthly_plan: obj.monthlyPlan };
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
  let monthly = draft.monthly_plan;
  if (monthly === undefined) monthly = draft.monthlyPlan;
  if (monthly === undefined) monthly = getLoose(draft, 'monthly_plan');
  if (typeof monthly === 'string') {
    const parsed = parseJsonPossiblyDoubleEncoded(monthly) || extractJsonObjectFromText(monthly);
    if (Array.isArray(parsed)) monthly = parsed;
  }
  if (Array.isArray(monthly)) draft.monthly_plan = monthly;
  return draft;
}

// Clear cache on server start to ensure fresh data
console.log('Clearing sort order cache on server start');
sortOrderCache.data = null;
sortOrderCache.lastFetch = 0;

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

/**
 * Get a user's saved courses
 */
app.get('/api/roadmap/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Read all rows from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E',
    });

    const values = response.data.values || [];
    
    // Get all courses for this user
    const userRows = values.filter(row => row[0] === userId);
    
    // Transform sheet data to the format we need
    const userCourses = userRows.map(row => ({
      id: row[1],
      title: row[2] || row[1],
      progress: parseInt(row[4] || '0', 10),
      sortOrder: sortOrderCache.data?.get(row[1]) || 999  // Default to high number if not found
    }));

    res.status(200).json({ courses: userCourses });
  } catch (err) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

/**
 * Add a course to user's roadmap
 */
app.post('/api/roadmap/:userId/add', async (req, res) => {
  try {
    const { userId } = req.params;
    const { courseId, courseTitle } = req.body;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E', // Now storing: userId, courseId, courseTitle, timestamp, progress
      valueInputOption: 'RAW',
      resource: {
        values: [[
          userId,
          courseId,
          courseTitle,
          new Date().toISOString(),
          "0" // Initial progress value
        ]]
      }
    });

    res.status(200).json({ message: 'Course added successfully' });
  } catch (err) {
    console.error('Error adding course:', err);
    res.status(500).json({ error: 'Failed to add course' });
  }
});

/**
 * Remove a course from user's roadmap
 */
app.post('/api/roadmap/:userId/remove', async (req, res) => {
  try {
    const { userId } = req.params;
    const { courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    // Get current data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E',
    });

    const values = response.data.values || [];
    
    // Find the row to remove
    const rowIndex = values.findIndex(row => 
      row[0] === userId && row[1] === courseId
    );

    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Course not found in roadmap' });
    }

    // Delete the row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: 0, // Assuming Sheet1 is id 0
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1
            }
          }
        }]
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing course:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a new function to update course progress
async function updateCourseProgress(userId, courseProgress) {
  try {
    // Get current data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E',
    });

    const values = response.data.values || [];
    const updates = [];

    // Find rows that need updating
    values.forEach((row, index) => {
      if (row[0] === userId) {
        const courseId = row[1];
        const newProgress = courseProgress[courseId];
        
        if (newProgress !== undefined && newProgress !== row[4]) {
          updates.push({
            range: `Sheet1!E${index + 1}`,
            values: [[newProgress.toString()]]
          });
        }
      }
    });

    // Batch update if there are changes
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
      console.log(`Updated progress for ${updates.length} courses`);
    }
  } catch (error) {
    console.error('Error updating course progress:', error);
  }
}

// Add a function to get sort order
async function getSortOrder() {
  const now = Date.now();
  
  // Return cached data if it's still fresh
  if (sortOrderCache.data && (now - sortOrderCache.lastFetch < sortOrderCache.expiryTime)) {
    console.log('Using cached sort order:', Object.fromEntries(sortOrderCache.data));
    return sortOrderCache.data;
  }

  try {
    // Fetch sort order from Sheet2
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet2!A:B'  // Get course_id and sort_order columns
    });

    const values = response.data.values || [];
    console.log('Sort order data from Sheet2 (raw):', values);
    
    // Create a map of courseId -> sortOrder
    const sortOrder = new Map();
    values.slice(1).forEach(row => {  // slice(1) to skip header row
      if (row[0] && row[1]) {  // Only add if both courseId and sortOrder exist
        // Store courseId in lowercase for case-insensitive matching
        sortOrder.set(row[0].toLowerCase(), parseInt(row[1], 10));
        console.log(`Setting sort order for "${row[0]}" to ${parseInt(row[1], 10)}`);
      }
    });
    
    console.log('Processed sort order map:', Object.fromEntries(sortOrder));
    // Explicitly log all entries for easier debugging
    for (const [key, value] of sortOrder.entries()) {
      console.log(`Sort order - Course: "${key}" = ${value}`);
    }

    // Update cache
    sortOrderCache.data = sortOrder;
    sortOrderCache.lastFetch = now;
    
    return sortOrder;
  } catch (error) {
    console.error('Error fetching sort order:', error);
    return new Map();  // Return empty map if fetch fails
  }
}

// We'll rename it to /api/roadmapData/:userId and make it return JSON only.
app.get('/api/roadmapData/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const username = decodeURIComponent(req.query.username || '') || 'Student';

    // Get sort order first
    const sortOrder = await getSortOrder();

    // Load data from Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E',
    });

    // Build userCourses array
    const values = response.data.values || [];
    let userCourses = values
      .filter(row => row[0] === userId)
      .map(row => {
        const course = {
          id: row[1],
          title: row[2] || row[1],
          progress: parseInt(row[4] || '0', 10),
          sortOrder: row[1] ? sortOrder.get(row[1].toLowerCase()) || 999 : 999  // Case-insensitive lookup
        };
        console.log(`Course ${course.title} (${course.id}) has sort order: ${course.sortOrder}`);
        return course;
      });

    console.log('Before sorting, courses:', userCourses.map(c => `${c.title} (order: ${c.sortOrder})`));

    // Sort courses by the specified order
    userCourses.sort((a, b) => {
      // Convert to numbers and handle undefined or null values
      const aOrder = Number(a.sortOrder) || 999;
      const bOrder = Number(b.sortOrder) || 999;
      return aOrder - bOrder;
    });

    console.log('After sorting, courses:', userCourses.map(c => `${c.title} (order: ${c.sortOrder})`));

    // Calculate total progress
    const totalProgress = userCourses.length
      ? Math.round(userCourses.reduce((sum, c) => sum + c.progress, 0) / userCourses.length)
      : 0;

    return res.status(200).json({
      userId,
      username,
      userCourses,
      totalProgress
    });
  } catch (err) {
    console.error('Error fetching roadmap data:', err);
    return res.status(500).json({ error: 'Error loading roadmap data' });
  }
});

// NEW route that returns immediate HTML with a spinner + client script
// which then calls /api/roadmapData/:userId to fetch the real data.
app.get('/roadmap/:userId', (req, res) => {
  const { userId } = req.params;
  const username = decodeURIComponent(req.query.username || '') || 'Student';

  // Minimal HTML for the iframe:
  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <title>Course Roadmap</title>
      <link href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body {
          margin: 0;
          padding: 16px; /* Reduced from 24px */
          font-family: 'Source Sans Pro', sans-serif;
          background: #000;
          color: #F6F8FF;
        }

        .header-container {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px; /* Reduced from 30px */
        }

        .total-progress-container {
          margin-top: 10px;
          background: transparent;
          border-radius: 8px;
          padding: 10px 15px;
          width: calc(100% - 30px);
          max-width: 600px;
          margin-left: auto;
          margin-right: 0;
          display: flex;
          align-items: center;
          justify-content: flex-end;
        }

        .total-progress {
          position: relative;
          padding: 0;
          background: none;
          border: none;
          margin-bottom: 5px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 15px;
        }

        .total-progress-text {
          color: #FFFFFF;
          font-size: 16px;
          margin: 0;
        }

        .total-progress-circle {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          position: relative;
          background: #000000;
          border: 2px solid #FFFFFF;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .total-progress-circle:before {
          content: '';
          position: absolute;
          width: 100%;
          height: 100%;
          background: conic-gradient(#FFFFFF var(--progress), transparent var(--progress));
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 15px 0; /* Reduced from original value */
        }

        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 3px solid rgba(163, 115, 248, 0.3);
          border-radius: 50%;
          border-top-color: #A373F8;
          animation: spin 1s ease-in-out infinite;
          margin-bottom: 20px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .loading-text {
          color: #A373F8;
          margin-top: 10px;
          font-size: 14px;
        }

        #roadmap-content {
          position: relative;
          padding-top: 5px; /* Reduced from 10px */
          padding-bottom: 5px; /* Reduced from 10px */
          display: none;
        }

        .timeline-line {
          position: absolute;
          left: 50%;
          top: 0;
          bottom: 0;
          width: 3px;
          background: #A373F8;
          z-index: 1;
          transform: translateX(-50%);
          opacity: 0.3;
        }

        .course-item {
          position: relative;
          margin: 20px 0; /* Reduced from 35px */
          padding-left: 0;
          display: flex;
          justify-content: center;
          width: 100%;
          min-height: 60px; /* Reduced from 80px */
        }

        .course-item:first-child {
          margin-top: 0;
        }

        .course-item:last-child {
          margin-bottom: 20px; /* Reduced from 30px */
        }
        
        .course-dot {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          z-index: 2;
          background: #000000;
          border: 2px solid #A373F8;
          box-sizing: border-box;
        }

        .course-content {
          position: relative;
          background: rgba(163, 115, 248, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          padding: 8px 12px; /* Reduced top/bottom padding */
          width: calc(100% * 0.4 - 50px);
          max-width: 280px;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          overflow: hidden; /* Add this to contain the progress overlay */
        }
        
        /* Add a new class for the progress overlay */
        .course-progress-overlay {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          background-color: rgba(163, 115, 248, 0.2); /* Changed from white to faint purple */
          z-index: 1;
          pointer-events: none; /* Allows clicks to pass through to elements below */
        }
        
        /* Ensure text is above the overlay */
        .course-title, .progress-text, .remove-button {
          position: relative;
          z-index: 2;
        }
        
        .course-content.left {
          margin-right: 50px;
          transform-origin: right center;
          margin-left: auto;
        }
        
        .course-content.right {
          margin-left: 50px;
          transform-origin: left center;
          margin-right: auto;
        }
        
        .course-content.left:hover {
          transform: translateX(-5px);
          box-shadow: 4px 4px 12px rgba(163, 115, 248, 0.1);
        }
        
        .course-content.right:hover {
          transform: translateX(5px);
          box-shadow: -4px 4px 12px rgba(163, 115, 248, 0.1);
        }

        .course-title {
          color: #FFFFFF;
          text-decoration: none;
          font-weight: 600;
          display: inline-block;
          margin-bottom: 4px;
          font-size: 17px;
          padding-right: 15px;
          line-height: 1.2;
          text-transform: uppercase;
        }

        .course-title:hover {
          text-decoration: underline;
        }
        
        .progress-text {
          font-size: 11px; /* Reduced from 12px */
          color: #A373F8;
          font-weight: 600;
          margin-top: 2px; /* Reduced from 5px */
        }

        .progress-bar {
          display: none; /* Hide the horizontal progress bar */
        }

        .progress-fill {
          display: none; /* Hide the horizontal progress fill */
        }

        .remove-button {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          color: rgba(163, 115, 248, 0.5);
          font-size: 18px;
          cursor: pointer;
          padding: 0;
          margin: 0;
          width: 24px;
          height: 24px;
          line-height: 24px;
          text-align: center;
          transition: color 0.2s ease;
          z-index: 10;
        }
        
        .course-content.left .remove-button {
          right: 10px;
        }
        
        .course-content.right .remove-button {
          right: 10px;
        }

        .remove-button:hover {
          color: rgba(163, 115, 248, 1);
        }

        @media (max-width: 768px) {
          .course-content {
            width: calc(100% - 70px);
            max-width: none;
          }
          
          .course-content.left, 
          .course-content.right {
            margin-left: 50px;
            margin-right: auto;
          }
          
          .timeline-line {
            left: 24px;
            transform: none;
          }
          
          .course-dot {
            left: 24px;
            transform: translateY(-50%);
          }
          
          .course-item {
            justify-content: flex-start;
          }
        }
      </style>
    </head>
    <body>
      <div class="loading-container" id="loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading your progress...</div>
      </div>

      <div id="roadmap-content">
        <div class="timeline-line"></div>
      </div>

      <!-- Remove the total progress container -->
      <div id="total-progress-container" style="display: none;"></div>

      <script>
        const userId = "${userId}";
        const apiURL = window.location.origin + "/api/roadmapData/" + userId;

        // Add window onload event to ensure proper sizing
        window.onload = function() {
          // Call sendHeight after everything is loaded
          setTimeout(sendHeight, 300);
          
          // Add resize listener
          window.addEventListener('resize', function() {
            sendHeight();
          });
        };

        fetch(apiURL)
          .then(res => {
            if (!res.ok) throw new Error('Failed to fetch data');
            return res.json();
          })
          .then((data) => {
            document.getElementById('loading').style.display = 'none';
            const container = document.getElementById('roadmap-content');
            container.style.display = 'block';

            if (!data.userCourses || data.userCourses.length === 0) {
              container.innerHTML = '<div style="text-align: center; padding: 30px 20px; color: #FFFFFF;"><p>No courses added yet.</p><p>If you\'ve just submitted your Onboarding Form and you don\'t see anything here, our system is still thinking about what courses to recommend, just refresh the page in a few minutes.</p><p>Use the Add/Remove buttons on the course cards below to add courses to your Course Roadmap.</p></div>';
              return;
            }

            let html = '<div class="timeline-line"></div>';
            
            data.userCourses.forEach((course, index) => {
              const side = index % 2 === 0 ? 'left' : 'right';
              
              html += \`
                <div class="course-item">
                  <div class="course-dot"></div>
                  <div class="course-content \${side}">
                    <div class="course-progress-overlay" style="width: \${course.progress}%;"></div>
                    <button 
                      class="remove-button" 
                      onclick="removeCourse(event, '\${course.id}')"
                    >×</button>
                    <a href="https://learn.futureproofmusicschool.com/path-player?courseid=\${course.id}" 
                       class="course-title" 
                       target="_blank" 
                       rel="noopener noreferrer">
                      \${course.title}
                    </a>
                    <div class="progress-text">\${course.progress}%</div>
                  </div>
                </div>
              \`;
            });

            container.innerHTML = html;

            // Total progress is hidden now, but we'll still calculate it for internal use
            const totalProgressContainer = document.getElementById('total-progress-container');
            totalProgressContainer.innerHTML = \`
              <div class="total-progress-container">
                <div class="total-progress">
                  <strong class="total-progress-text">Total Progress: \${Math.round(data.totalProgress)}%</strong>
                  <div class="total-progress-circle" style="--progress: \${Math.round(data.totalProgress)}%;"></div>
                </div>
              </div>
            \`;

            sendHeight();
            // Call sendHeight again after a longer delay to ensure all content is rendered
            setTimeout(sendHeight, 500);

            // Update the HTML for each course when recalculating the view
            const newCourseItems = document.querySelectorAll('.course-item');
            newCourseItems.forEach((item, index) => {
              const progressText = item.querySelector('.progress-text');
              const progress = parseInt(progressText.textContent) || 0;
              const progressOverlay = item.querySelector('.course-progress-overlay');
              if (progressOverlay) {
                progressOverlay.style.width = \`\${progress}%\`;
              }
            });
          })
          .catch(err => {
            console.error('Error:', err);
          });

        function sendHeight() {
          // Allow a small delay for rendering to complete
          setTimeout(() => {
            // Get the actual content height
            const contentEl = document.getElementById('roadmap-content');
            const progressEl = document.getElementById('total-progress-container');
            
            // Calculate total height needed
            let totalHeight = 30; // Base padding
            
            if (contentEl) totalHeight += contentEl.offsetHeight;
            if (progressEl) totalHeight += progressEl.offsetHeight;
            
            // Ensure minimum height (adjust as needed)
            const minHeight = 500;
            totalHeight = Math.max(totalHeight, minHeight);
            
            console.log('Sending height:', totalHeight);
            
            // Send message to parent
            window.parent.postMessage({ 
              type: 'resize', 
              height: totalHeight
            }, '*');
          }, 100);
        }

        // Add remove course function
        async function removeCourse(event, courseId) {
          try {
            const response = await fetch(\`\${window.location.origin}/api/roadmap/\${userId}/remove\`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ courseId })
            });

            if (!response.ok) throw new Error('Failed to remove course');

            // Remove the course item from DOM with a fade-out effect
            const courseItem = event.target.closest('.course-item');
            courseItem.style.transition = 'opacity 0.3s ease';
            courseItem.style.opacity = '0';
            
            setTimeout(() => {
              courseItem.remove();
              
              // Recalculate total progress
              const progressElements = document.querySelectorAll('.progress-text');
              let totalProgress = 0;
              
              if (progressElements.length > 0) {
                totalProgress = Array.from(progressElements).reduce((sum, el) => {
                  return sum + (parseInt(el.textContent) || 0);
                }, 0) / progressElements.length;
              }
              
              // Update total progress display (hidden but we'll still update it)
              document.querySelector('#total-progress-container').innerHTML = \`
                <div class="total-progress-container">
                  <div class="total-progress">
                    <strong class="total-progress-text">Total Progress: \${Math.round(totalProgress)}%</strong>
                    <div class="total-progress-circle" style="--progress: \${Math.round(totalProgress)}%;"></div>
                  </div>
                </div>
              \`;
              
              // Make sure progress overlays are updated on remaining course items
              document.querySelectorAll('.course-item').forEach((item) => {
                const progressText = item.querySelector('.progress-text');
                const progress = parseInt(progressText.textContent) || 0;
                const progressOverlay = item.querySelector('.course-progress-overlay');
                if (progressOverlay) {
                  progressOverlay.style.width = \`\${progress}%\`;
                }
              });
              
              sendHeight();
            }, 300);
          } catch (error) {
            console.error('Error removing course:', error);
            // Only show error message if the removal actually failed
            const errorMsg = document.createElement('div');
            errorMsg.style.cssText = \`
              position: fixed;
              top: 20px;
              right: 20px;
              background: rgba(255, 0, 0, 0.1);
              color: #ff6b6b;
              padding: 10px 20px;
              border-radius: 4px;
              transition: opacity 0.3s ease;
            \`;
            errorMsg.textContent = 'Failed to remove course';
            document.body.appendChild(errorMsg);
            setTimeout(() => {
              errorMsg.style.opacity = '0';
              setTimeout(() => errorMsg.remove(), 300);
            }, 2000);
          }
        }
      </script>
    </body>
  </html>
  `;

  res.send(html);
});

// Add new endpoint to proxy the LearnWorlds API call
app.get('/api/progress/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('Server: Progress endpoint called for user:', userId);
    // Require client credentials; token will be generated dynamically
    const hasClient = !!process.env.LEARNWORLDS_CLIENT_ID;
    const hasSecret = !!process.env.LEARNWORLDS_CLIENT_SECRET;
    if (!hasClient || !hasSecret) {
      console.error('LearnWorlds client credentials missing. hasClient:', hasClient, 'hasSecret:', hasSecret);
      return res.status(500).json({ error: 'Missing LearnWorlds client credentials on server', hasClient, hasSecret });
    }
    
    // Get progress from LearnWorlds API  
    const apiUrl = `https://learn.futureproofmusicschool.com/admin/api/v2/users/${userId}/progress`;
    console.log('Server: Calling LearnWorlds API at:', apiUrl);

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
      console.error('LearnWorlds API error status:', status);
      console.error('LearnWorlds API error headers:', headersObj);
      const errorText = await progressResponse.text();
      console.error('LearnWorlds API error response body:', errorText?.slice(0, 500));
      return res.status(500).json({ error: 'LearnWorlds upstream error', status, headers: headersObj, body: errorText });
    }

    const data = await progressResponse.json();
    console.log('LearnWorlds API response data:', JSON.stringify(data, null, 2));
    
    if (!data.data || !Array.isArray(data.data)) {
      console.error('Unexpected response format from LearnWorlds API:', data);
      throw new Error('Invalid response format from LearnWorlds API');
    }
    
    console.log(`Found ${data.data.length} courses with progress data`);
    
    // Update progress in Google Sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E',
    });

    const values = response.data.values || [];
    console.log('Current sheet data rows:', values.length);

    const updates = [];

    // For each course in the API response, update its progress in the sheet
    data.data.forEach(course => {
      console.log('Processing course:', course.course_id, 'progress:', course.progress_rate);
      const rowIndex = values.findIndex(row => 
        row[0] === userId && row[1] === course.course_id
      );
      
      console.log('Found row index:', rowIndex, 'for course:', course.course_id);
      
      if (rowIndex !== -1) {
        updates.push({
          range: `Sheet1!E${rowIndex + 1}`,
          values: [[course.progress_rate]]
        });
        console.log('Added update for row:', rowIndex + 1, 'progress:', course.progress_rate);
      } else {
        console.log('Course not found in roadmap, skipping:', course.course_id);
      }
    });

    console.log('Updates to make:', updates.length);

    // Batch update the progress values
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
      console.log('Updated sheet with progress values for', updates.length, 'courses');
    } else {
      console.log('No progress updates to make');
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching/storing progress:', error);
    res.status(500).json({ error: error.message });
  }
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
// NEW MILESTONE ROADMAP ENDPOINTS
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
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

    let roadmapPlan = parseJsonPossiblyDoubleEncoded(rawPlan)
      || extractJsonObjectFromText(rawPlan);
    roadmapPlan = normalizeMonthlyPlanKeys(roadmapPlan);
    roadmapPlan = normalizePlanObjectLoose(roadmapPlan);
    const roadmapProgress = parseJsonPossiblyDoubleEncoded(rawProgress);
    console.log('Milestone API: parsed roadmapPlan present:', !!roadmapPlan, 'keys:', roadmapPlan ? Object.keys(roadmapPlan) : []);
    console.log('Milestone API: has monthly_plan array:', !!(roadmapPlan && Array.isArray(roadmapPlan.monthly_plan)), 'len:', roadmapPlan && Array.isArray(roadmapPlan.monthly_plan) ? roadmapPlan.monthly_plan.length : 'n/a');
    
    res.json({
      userId,
      username: userRow[1] || 'Student',
      roadmapPlan,
      roadmapProgress
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
      hasMonthlyPlanArrayBefore: !!(planBefore && Array.isArray(planBefore.monthly_plan)),
      keysAfter: planAfter ? Object.keys(planAfter) : [],
      hasMonthlyPlanArrayAfter: !!(planAfter && Array.isArray(planAfter.monthly_plan)),
      monthlyPlanLength: planAfter && Array.isArray(planAfter.monthly_plan) ? planAfter.monthly_plan.length : null,
      hasProgress: !!rawProgress,
    };
    res.json(diagnostics);
  } catch (error) {
    console.error('Milestone debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update milestone progress (mark complete)
 */
app.post('/api/milestone-roadmap/:userId/complete', async (req, res) => {
  // Set CORS headers explicitly for this endpoint
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  try {
    const { userId } = req.params;
    const { milestoneNumber } = req.body;
    
    console.log(`Marking milestone ${milestoneNumber} complete for user ${userId}`);
    
    // First, get current data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: MILESTONE_SPREADSHEET_ID,
      range: 'sheet1!A:F',
    });

    const rows = response.data.values || [];
    const userRowIndex = rows.findIndex(row => row[0] === userId);
    
    if (userRowIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get current progress or create new
    let progress = rows[userRowIndex][5] ? JSON.parse(rows[userRowIndex][5]) : {
      userId,
      currentMilestone: 1,
      milestonesCompleted: [],
      milestoneProgress: {}
    };
    
    // Update progress
    if (!progress.milestonesCompleted.includes(milestoneNumber)) {
      progress.milestonesCompleted.push(milestoneNumber);
      progress.milestonesCompleted.sort((a, b) => a - b);
    }
    
    // Update current milestone to the next incomplete one
    progress.currentMilestone = Math.min(milestoneNumber + 1, 12);
    
    // Add completion timestamp
    progress.milestoneProgress[milestoneNumber] = {
      ...progress.milestoneProgress[milestoneNumber],
      completed: true,
      completedDate: new Date().toISOString()
    };
    
    // Update the sheet (column F, which is index 5)
    const updateRange = `sheet1!F${userRowIndex + 1}`;
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
    console.error('Error updating milestone progress:', error);
    res.status(500).json({ error: 'Failed to update progress' });
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
          text-decoration: none;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .view-toggle:hover { text-decoration: underline; }
        
        .timeline {
          position: relative;
          padding: 20px 0;
          min-height: 100vh;
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
        
        .complete-button {
          background: #A373F8;
          color: #000;
          border: none;
          padding: 12px 30px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-top: 20px;
        }
        
        .complete-button:hover {
          background: #8b5df6;
          transform: translateY(-2px);
        }
        
        .complete-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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
              console.log('[Client] roadmapPlan present. monthly_plan length:', Array.isArray(data.roadmapPlan.monthly_plan) ? data.roadmapPlan.monthly_plan.length : 'n/a');
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
          const { roadmapPlan, roadmapProgress } = data;
          
          if (!roadmapPlan || !roadmapPlan.monthly_plan) {
            document.getElementById('app').innerHTML = '<div class="loading">No roadmap found. Please complete your onboarding form.</div>';
            sendHeight();
            return;
          }
          
          const progress = roadmapProgress || {
            currentMilestone: 1,
            milestonesCompleted: [],
            milestoneProgress: {}
          };
          
          const currentMilestone = progress.currentMilestone || 1;
          const completed = progress.milestonesCompleted || [];

          // Expose data for client-side interactions (e.g., clicking milestones)
          window.ROADMAP_PLAN = roadmapPlan;
          window.ROADMAP_PROGRESS = progress;
          window.CURRENT_MILESTONE = currentMilestone;
          
          let html = '<div class="header">' +
            '<h1>Welcome back, ' + username + '!</h1>' +
            '<div class="north-star">Your Goal: "' + roadmapPlan.northstar + '"</div>' +
            '<div class="progress-stats">' +
              '<a href="#" onclick="showCurrentMilestone(event)" class="view-toggle">🎯 Milestone ' + currentMilestone + ' of 12</a>' +
              '<span>✅ ' + completed.length + ' Completed</span>' +
              '<span>📊 ' + Math.round((completed.length / 12) * 100) + '% Progress</span>' +
              '<a id="path-link" class="view-toggle" href="#" onclick="showPathView(event)">🧭 My Path</a>' +
            '</div>' +
            '</div>';

          // Move the current milestone detail ABOVE the timeline
          const currentMilestoneData = roadmapPlan.monthly_plan[currentMilestone - 1];
          if (currentMilestoneData) {
            html += '<div id="current-view-wrap" class="current-view-wrap">' +
              '<div id="current-view" class="current-milestone-detail">' +
              '<div class="milestone-nav">' +
                '<button id="nav-prev" class="nav-arrow" onclick="navigateMilestone(-1)">‹</button>' +
                '<h2 style="margin: 0;">COURSE ' + currentMilestone + ': ' + currentMilestoneData.focus + '</h2>' +
                '<button id="nav-next" class="nav-arrow" onclick="navigateMilestone(1)">›</button>' +
              '</div>';
            if (currentMilestoneData.course_rec) {
              html += '<div class="course-recommendation">' +
                '<a href="' + currentMilestoneData.course_rec.url + '" class="course-recommendation-link" target="_blank">' +
                  '<h3>Recommended Course</h3>' +
                  '<div>' + currentMilestoneData.course_rec.title + '</div>' +
                  '<div style="font-size: 14px; opacity: 0.8; margin-top: 5px;">' +
                    currentMilestoneData.course_rec.benefit +
                  '</div>' +
                  '<div id="rec-cta" class="rec-cta" style="margin-top:10px; color:#A373F8; font-weight:700;">Start Course →</div>' +
                '</a>' +
              '</div>';
            }
            
            // Add course progress section placeholder
            html += '<div id="course-progress-container"></div>';
            
            html += '<div class="milestone-section">' +
                '<div class="milestone-goal">' +
                  '<h3>Goal</h3>' +
                  (currentMilestoneData.goal || currentMilestoneData.milestone) +
                '</div>' +
              '</div>';
            '</div>' +
            '</div>';
          }

          html += '<div id="path-view" style="display:none; background: rgba(0,0,0,1); min-height: 800px; padding: 20px;"><div class="timeline">' +
              '<div class="timeline-line"></div>';
          
          // Render timeline
          console.log('[Client] About to render timeline. monthly_plan length:', roadmapPlan.monthly_plan ? roadmapPlan.monthly_plan.length : 'undefined');
          if (roadmapPlan.monthly_plan && Array.isArray(roadmapPlan.monthly_plan)) {
            roadmapPlan.monthly_plan.forEach((milestone, index) => {
              const num = index + 1;
              const isCompleted = completed.includes(num);
              const isCurrent = num === currentMilestone;
              
              console.log('[Client] Rendering milestone', num, 'focus:', milestone.focus);
              
              html += '<div class="milestone ' + (isCompleted ? 'completed' : '') + ' ' + (isCurrent ? 'current' : '') + '">' +
                '<div class="milestone-dot"></div>' +
                '<div class="milestone-content clickable" onclick="showMilestoneDetail(' + num + ')">' +
                  '<div class="milestone-title">' +
                    (isCompleted ? '✅' : (isCurrent ? '🎯' : '🔒')) + ' ' +
                    'Course ' + num + ': ' + (milestone.focus || 'No Focus') +
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
            console.log('[Client] No monthly_plan found or not an array');
            html += '<div style="color: #A373F8; text-align: center; padding: 50px;">No milestones found. Please complete your onboarding form.</div>';
          }
          
          html += '</div></div>';
          
          document.getElementById('app').innerHTML = html;
          // Hydrate recommendation progress (if any)
          if (currentMilestoneData && currentMilestoneData.course_rec) {
            hydrateRecommendationProgress(currentMilestoneData.course_rec);
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
            const total = Array.isArray(plan?.monthly_plan) ? plan.monthly_plan.length : 12;
            const current = Number(window.DISPLAYED_MILESTONE || 1);
            const prevBtn = document.getElementById('nav-prev');
            const nextBtn = document.getElementById('nav-next');
            if (prevBtn) prevBtn.disabled = current <= 1;
            if (nextBtn) nextBtn.disabled = current >= total;
          } catch (_) {}
        }

        function navigateMilestone(direction) {
          const plan = window.ROADMAP_PLAN;
          if (!plan || !Array.isArray(plan.monthly_plan)) return;
          const total = plan.monthly_plan.length;
          const current = Number(window.DISPLAYED_MILESTONE || window.CURRENT_MILESTONE || 1);
          let next = current + Number(direction || 0);
          if (next < 1) next = 1;
          if (next > total) next = total;
          if (next !== current) {
            showMilestoneDetail(next);
          }
        }

        // Show the details for a selected milestone and return to the detail view
        function showMilestoneDetail(milestoneNumber) {
          // Always attempt to scroll to top in iframe immediately
          try { window.scrollTo(0, 0); } catch (_) {}
          const plan = window.ROADMAP_PLAN;
          const progress = window.ROADMAP_PROGRESS || { currentMilestone: 1 };
          if (!plan || !Array.isArray(plan.monthly_plan)) return;
          const idx = Number(milestoneNumber) - 1;
          const data = plan.monthly_plan[idx];
          if (!data) return;

          const isCurrent = Number(milestoneNumber) === Number(progress.currentMilestone);
          const currentEl = document.getElementById('current-view');
          if (currentEl) {
            let inner = '' +
              '<div class="milestone-nav">' +
                '<button id="nav-prev" class="nav-arrow" onclick="navigateMilestone(-1)">‹</button>' +
                '<h2 style="margin: 0;">COURSE ' + milestoneNumber + ': ' + data.focus + '</h2>' +
                '<button id="nav-next" class="nav-arrow" onclick="navigateMilestone(1)">›</button>' +
              '</div>';
            if (data.course_rec) {
              inner += '<div class="course-recommendation">' +
                '<a href="' + data.course_rec.url + '" class="course-recommendation-link" target="_blank">' +
                  '<h3>Recommended Course</h3>' +
                  '<div>' + data.course_rec.title + '</div>' +
                  '<div style="font-size: 14px; opacity: 0.8; margin-top: 5px;">' +
                    data.course_rec.benefit +
                  '</div>' +
                  '<div id="rec-cta" class="rec-cta" style="margin-top:10px; color:#A373F8; font-weight:700;">Start Course →</div>' +
                '</a>' +
              '</div>';
            }
            
            // Add course progress section placeholder
            inner += '<div id="course-progress-container"></div>';
            
            inner += '<div class="milestone-section">' +
                '<div class="milestone-goal">' +
                  '<h3>Goal</h3>' +
                  (data.goal || data.milestone || '') +
                '</div>' +
              '</div>' +
              '';

            currentEl.innerHTML = inner;
          }

          // Track currently displayed milestone
          window.DISPLAYED_MILESTONE = Number(milestoneNumber);
          updateNavArrows();

          // Switch back to detail view
          const path = document.getElementById('path-view');
          const wrap = document.getElementById('current-view-wrap');
          if (path) path.style.display = 'none';
          if (wrap) wrap.style.display = '';

          // Hydrate recommendation progress for the selected milestone
          if (data && data.course_rec) {
            hydrateRecommendationProgress(data.course_rec);
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

        async function hydrateRecommendationProgress(courseRec) {
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
            
            // No longer updating simple progress bar as it's been removed
            
            // Render detailed progress section
            if (progressContainer && data.progress_rate !== undefined) {
              progressContainer.innerHTML = renderCourseProgress(data);
            }
            
              sendHeight();
              setTimeout(sendHeight, 300);
          } catch (e) {
            console.error('Error loading course progress:', e);
            const progressContainer = document.getElementById('course-progress-container');
            if (progressContainer) progressContainer.innerHTML = '';
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
          
          let html = '<div class="course-progress-section">';
          
          // Header
          html += '<div class="progress-header">' +
            '<div class="progress-title">Course Progress Details</div>' +
            statusBadge +
            '</div>';
          
          // Achievement banner for completed courses
          if (status === 'completed') {
            html += '<div class="achievement-banner">' +
              '<div class="achievement-icon">🎉</div>' +
              '<div class="achievement-text">Congratulations! You\\\'ve completed this course!</div>' +
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
          
          // Stats cards
          html += '<div class="progress-stats">' +
            '<div class="stat-card">' +
              '<div class="stat-icon">' + statusIcon + '</div>' +
              '<div class="stat-value">' + progressRate + '%</div>' +
              '<div class="stat-label">Complete</div>' +
            '</div>' +
            '<div class="stat-card">' +
              '<div class="stat-icon">📊</div>' +
              '<div class="stat-value">' + (averageScore > 0 ? averageScore + '%' : 'N/A') + '</div>' +
              '<div class="stat-label">Avg Score</div>' +
            '</div>' +

            '<div class="stat-card">' +
              '<div class="stat-icon">📝</div>' +
              '<div class="stat-value">' + completedUnits + '/' + totalUnits + '</div>' +
              '<div class="stat-label">Lessons</div>' +
            '</div>' +
            '</div>';
          
          // Assessments breakdown (quizzes and projects only)
          if (data.progress_per_section_unit && data.progress_per_section_unit.length > 0) {
            // First, collect all assessment units
            let assessmentUnits = [];
            data.progress_per_section_unit.forEach(function(section) {
              if (section.units && section.units.length > 0) {
                section.units.forEach(function(unit) {
                  // Only include assessment-type units
                  if (unit.unit_type === 'assessment' || unit.unit_type === 'quiz' || unit.unit_type === 'project' || 
                      (unit.unit_name && (unit.unit_name.toLowerCase().includes('quiz') || 
                                         unit.unit_name.toLowerCase().includes('assessment') ||
                                         unit.unit_name.toLowerCase().includes('project')))) {
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
                const unitScore = unit.score_on_unit;
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
                  '<div style="display: flex; align-items: center;">';
                
                if (unitScore !== null && unitScore !== undefined) {
                  html += '<div class="unit-score">' + unitScore + '%</div>';
                }
                
                html += '<div class="unit-status ' + statusClass + '">' + statusText + '</div>' +
                  '</div>' +
                  '</div>';
              });
              
              html += '</div>';
            }
          }
          
          html += '</div>';
          
          return html;
        }
        
        async function markComplete(milestoneNumber) {
          // Only allow completing the current milestone
          try {
            const progress = window.ROADMAP_PROGRESS || { currentMilestone: 1 };
            if (Number(milestoneNumber) !== Number(progress.currentMilestone)) {
              alert('You can only complete your current milestone.');
              return;
            }
          } catch (_) {}
          if (!confirm('Mark this milestone as complete?')) return;
          
          try {
            const response = await fetch(apiBaseUrl + '/api/milestone-roadmap/' + userId + '/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ milestoneNumber })
            });
            
            if (!response.ok) {
              throw new Error('Failed to update progress');
            }
            
            // Reload the roadmap to show updated progress
            loadRoadmap();
          } catch (error) {
            console.error('Error marking complete:', error);
            alert('Failed to update progress. Please try again.');
          }
        }

        // Show the current milestone view
        function showCurrentMilestone(event) {
          if (event) event.preventDefault();
          const currentMilestone = window.CURRENT_MILESTONE || 1;
          showMilestoneDetail(currentMilestone);
        }
        
        // Show the full path view
        function showPathView(event) {
          if (event) event.preventDefault();
          const current = document.getElementById('current-view-wrap');
          const path = document.getElementById('path-view');
          if (current) current.style.display = 'none';
          if (path) path.style.display = '';
          sendHeight();
          setTimeout(sendHeight, 200);
          setTimeout(sendHeight, 800);
        }
        
        // No string parsing of practices; renderer expects structured objects.

        // Load roadmap on page load
        loadRoadmap();

        // Send height to parent so the iframe expands to fit content
        function sendHeight() {
          try {
            const totalHeight = Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight,
              document.body.offsetHeight,
              document.documentElement.offsetHeight,
              document.body.clientHeight,
              document.documentElement.clientHeight
            );
            window.parent.postMessage({ type: 'resize', height: totalHeight }, '*');
          } catch (e) {
            // no-op
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