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
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;  // From your Google Sheet's URL
const sortOrderCache = {
  data: null,
  lastFetch: 0,
  expiryTime: 1000 * 60 * 5 // Cache for 5 minutes (reduced from 1 hour)
};

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
    
    // Get progress from LearnWorlds API  
    const apiUrl = `https://learn.futureproofmusicschool.com/admin/api/v2/users/${userId}/progress`;
    console.log('Server: Calling LearnWorlds API at:', apiUrl);

    const progressResponse = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.LEARNWORLDS_ACCESS_TOKEN}`,
        'Lw-Client': process.env.LEARNWORLDS_CLIENT_ID
      }
    });

    if (!progressResponse.ok) {
      console.error('LearnWorlds API error status:', progressResponse.status);
      console.error('LearnWorlds API error headers:', Object.fromEntries([...progressResponse.headers.entries()]));
      const errorText = await progressResponse.text();
      console.error('LearnWorlds API error response:', errorText);
      throw new Error(`Failed to fetch progress: ${errorText}`);
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
      const maskedId = (process.env.SPREADSHEET_ID || '').slice(0, 6) + '...' + (process.env.SPREADSHEET_ID || '').slice(-4);
      console.log('Milestone API: SPREADSHEET_ID:', maskedId, 'Range: sheet1!A:F');
    } catch (_) {}
    
    // Read from spreadsheet - using sheet1 as the tab name (lowercase)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
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

    let roadmapPlan = parseJsonPossiblyDoubleEncoded(rawPlan);
    if (!roadmapPlan) {
      roadmapPlan = extractJsonObjectFromText(rawPlan);
    }
    roadmapPlan = normalizeMonthlyPlanKeys(roadmapPlan);
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
      spreadsheetId: SPREADSHEET_ID,
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
      spreadsheetId: SPREADSHEET_ID,
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
          font-size: 24px;
          margin-bottom: 10px;
        }
        
        .north-star {
          color: #F6F8FF;
          font-size: 16px;
          margin-bottom: 15px;
          opacity: 0.9;
        }
        
        .progress-stats {
          display: flex;
          gap: 20px;
          font-size: 14px;
          color: #A373F8;
        }
        
        .timeline {
          position: relative;
          padding: 20px 0;
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
          padding: 30px;
          margin: 30px auto;
          max-width: 600px;
        }
        
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
        
        .practices-list {
          list-style: none;
          padding-left: 0;
        }
        
        .practices-list li {
          padding: 8px 0;
          padding-left: 25px;
          position: relative;
        }
        
        .practices-list li:before {
          content: "•";
          color: #A373F8;
          position: absolute;
          left: 0;
        }
        
        .milestone-goal {
          background: rgba(0, 0, 0, 0.5);
          padding: 15px;
          border-radius: 8px;
          border-left: 3px solid #A373F8;
          margin: 15px 0;
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
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
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
          } catch (error) {
            console.error('Error loading roadmap:', error);
            document.getElementById('app').innerHTML = '<div class="loading">Error loading roadmap. Please refresh the page.</div>';
          }
        }
        
        function renderRoadmap(data) {
          const { roadmapPlan, roadmapProgress } = data;
          
          if (!roadmapPlan || !roadmapPlan.monthly_plan) {
            document.getElementById('app').innerHTML = '<div class="loading">No roadmap found. Please complete your onboarding form.</div>';
            return;
          }
          
          const progress = roadmapProgress || {
            currentMilestone: 1,
            milestonesCompleted: [],
            milestoneProgress: {}
          };
          
          const currentMilestone = progress.currentMilestone || 1;
          const completed = progress.milestonesCompleted || [];
          
          let html = '<div class="header">' +
            '<h1>Welcome back, ' + username + '!</h1>' +
            '<div class="north-star">Your Goal: "' + roadmapPlan.northstar + '"</div>' +
            '<div class="progress-stats">' +
              '<span>🎯 Milestone ' + currentMilestone + ' of 12</span>' +
              '<span>✅ ' + completed.length + ' Completed</span>' +
              '<span>📊 ' + Math.round((completed.length / 12) * 100) + '% Progress</span>' +
            '</div>' +
            '</div>' +
            '<div class="timeline">' +
              '<div class="timeline-line"></div>';
          
          // Render timeline
          roadmapPlan.monthly_plan.forEach((milestone, index) => {
            const num = index + 1;
            const isCompleted = completed.includes(num);
            const isCurrent = num === currentMilestone;
            
            if (isCurrent) {
              html += '<div class="current-indicator">═══ YOU ARE HERE ═══</div>';
            }
            
            html += '<div class="milestone ' + (isCompleted ? 'completed' : '') + ' ' + (isCurrent ? 'current' : '') + '">' +
              '<div class="milestone-dot"></div>' +
              '<div class="milestone-content">' +
                '<div class="milestone-title">' +
                  (isCompleted ? '✅' : (isCurrent ? '🎯' : '🔒')) + ' ' +
                  'Milestone ' + num + ': ' + milestone.focus +
                '</div>' +
              '</div>' +
            '</div>';
          });
          
          html += '</div>';
          
          // Render current milestone details
          const currentMilestoneData = roadmapPlan.monthly_plan[currentMilestone - 1];
          if (currentMilestoneData) {
            html += '<div class="current-milestone-detail">' +
              '<h2>MILESTONE ' + currentMilestone + ': ' + currentMilestoneData.focus + '</h2>' +
              '<div class="milestone-section">' +
                '<h3>Weekly Practices</h3>' +
                '<ul class="practices-list">';
            
            currentMilestoneData.weekly_practices.forEach(practice => {
              html += '<li>' + practice + '</li>';
            });
            
            html += '</ul></div>' +
              '<div class="milestone-section">' +
                '<div class="milestone-goal">' +
                  '<h3>Goal</h3>' +
                  currentMilestoneData.milestone +
                '</div>' +
              '</div>';
            
            if (currentMilestoneData.course_rec) {
              html += '<div class="course-recommendation">' +
                '<h3>Recommended Course</h3>' +
                '<div>' + currentMilestoneData.course_rec.title + '</div>' +
                '<div style="font-size: 14px; opacity: 0.8; margin-top: 5px;">' +
                  currentMilestoneData.course_rec.benefit +
                '</div>' +
                '<a href="' + currentMilestoneData.course_rec.url + '" class="course-link" target="_blank">' +
                  'Start Course →' +
                '</a>' +
              '</div>';
            }
            
            html += '<button class="complete-button" onclick="markComplete(' + currentMilestone + ')">' +
              '☐ Mark Milestone Complete' +
              '</button>' +
            '</div>';
          }
          
          document.getElementById('app').innerHTML = html;
        }
        
        async function markComplete(milestoneNumber) {
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
        
        // Load roadmap on page load
        loadRoadmap();
      </script>
    </body>
  </html>
  `;
  
  res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 