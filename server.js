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

// Add CORS middleware
app.use(cors({
  origin: 'https://www.futureproofmusicschool.com',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(bodyParser.json());

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
  expiryTime: 1000 * 60 * 60 // Cache for 1 hour
};

// Add a health check endpoint
app.get('/', (req, res) => {
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
    
    // Check if this user has any courses (including Getting Started)
    const userRows = values.filter(row => row[0] === userId);
    const hasGettingStarted = userRows.some(row => row[1] === 'getting-started');

    // If this is user's first time (no Getting Started course), add it
    if (!hasGettingStarted) {
      console.log('First time user, adding Getting Started course...');
      
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A:D', // Changed from A:E since we don't store progress
          valueInputOption: 'RAW',
          resource: {
            values: [[
              userId,
              'getting-started',
              'Getting Started',
              new Date().toISOString()
            ]]
          }
        });
        
        // Add it to our current results without progress
        userRows.push([userId, 'getting-started', 'Getting Started', new Date().toISOString()]);
      } catch (error) {
        console.error('Error adding Getting Started course:', error);
      }
    }

    // Map all courses to just their IDs for the response
    const userCourses = userRows.map(row => row[1]);

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
    const { courseId, courseTitle } = req.body; // Remove progress from destructuring

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:D', // Now just storing: userId, courseId, courseTitle, timestamp
      valueInputOption: 'RAW',
      resource: {
        values: [[
          userId,
          courseId,
          courseTitle,
          new Date().toISOString()
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
    
    // Get current data - update range to include all columns
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:D', // Changed from A:C to A:D
    });

    // Find the row to remove
    const values = response.data.values || [];
    const rowIndex = values.findIndex(row => 
      row[0] === userId && row[1] === courseId
    );

    if (rowIndex !== -1) {
      // Clear the row - update range to include all columns
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!A${rowIndex + 1}:D${rowIndex + 1}`, // Changed from C to D
      });
    }

    res.status(200).json({ message: 'Course removed successfully' });
  } catch (err) {
    console.error('Error removing course:', err);
    res.status(500).json({ error: 'Failed to remove course' });
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
        
        if (newProgress !== undefined && newProgress !== row[3]) {
          updates.push({
            range: `Sheet1!D${index + 1}`,
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
    return sortOrderCache.data;
  }

  try {
    // Fetch sort order from Sheet2
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet2!A:B'  // Get course_id and sort_order columns
    });

    const values = response.data.values || [];
    
    // Create a map of courseId -> sortOrder
    const sortOrder = new Map();
    values.slice(1).forEach(row => {  // slice(1) to skip header row
      if (row[0] && row[1]) {  // Only add if both courseId and sortOrder exist
        sortOrder.set(row[0], parseInt(row[1], 10));
      }
    });

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
      .map(row => ({
        id: row[1],
        title: row[2] || row[1],
        progress: parseInt(row[4] || '0', 10),
        sortOrder: sortOrder.get(row[1]) || 999  // Default to high number if not found
      }));

    // If 'getting-started' is missing, add it
    const hasGettingStarted = userCourses.some(c => c.id === 'getting-started');
    if (!hasGettingStarted) {
      userCourses.unshift({
        id: 'getting-started',
        title: 'Getting Started',
        progress: 0,
        sortOrder: 1  // Always first
      });
    }

    // Sort courses by sortOrder
    userCourses.sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999));

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
          padding: 24px;
          font-family: 'Source Sans Pro', sans-serif;
          background: #000;
          color: #F6F8FF;
        }

        .header-container {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 30px;
        }

        .total-progress {
          background: rgba(163, 115, 248, 0.1);
          border: 1px solid rgba(163, 115, 248, 0.2);
          border-radius: 8px;
          padding: 15px;
          min-width: 200px;
          text-align: center;
        }

        .total-progress-bar {
          height: 8px;
          background: rgba(163, 115, 248, 0.2);
          border-radius: 4px;
          overflow: hidden;
        }

        .total-progress-fill {
          height: 100%;
          background: #A373F8;
          transition: width 0.3s ease;
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 300px;
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
          font-size: 16px;
        }

        #roadmap-content {
          display: none;
          position: relative;
          padding-top: 0;
        }

        .timeline-line {
          position: absolute;
          left: 20px;
          top: 10px;
          bottom: 0;
          width: 2px;
          background: rgba(163, 115, 248, 0.3);
        }

        .course-item {
          position: relative;
          margin: 20px 0;
          padding-left: 40px;
        }

        .course-item:first-child {
          margin-top: 0;
        }

        .course-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          position: absolute;
          left: 15px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 2;
          background: #000000;
          border: 2px solid #A373F8;
          box-sizing: border-box;
        }

        .course-dot.completed {
          background: #A373F8;
          border: none;
        }

        .course-content {
          background: rgba(163, 115, 248, 0.1);
          border: 1px solid rgba(163, 115, 248, 0.2);
          border-radius: 8px;
          padding: 15px;
          width: calc(100% - 60px);
          max-width: 600px;
        }

        .course-title {
          color: #A373F8;
          text-decoration: none;
          font-weight: 600;
          display: block;
          margin-bottom: 10px;
        }

        .course-title:hover {
          text-decoration: underline;
        }

        .progress-bar {
          height: 6px;
          background: rgba(163, 115, 248, 0.2);
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: #A373F8;
          transition: width 0.3s ease;
        }

        h2 {
          text-transform: lowercase;
          margin: 0 0 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="header-container">
        <h2>course roadmap for ${username}</h2>
      </div>

      <div class="loading-container" id="loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading your progress...</div>
      </div>

      <div id="roadmap-content">
        <div class="timeline-line"></div>
      </div>

      <div id="total-progress-container"></div>

      <script>
        const userId = "${userId}";
        const apiURL = window.location.origin + "/api/roadmapData/" + userId;

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
              container.innerHTML = '<p>No courses yet.</p>';
              return;
            }

            let html = '<div class="timeline-line"></div>';
            
            data.userCourses.forEach(course => {
              html += \`
                <div class="course-item">
                  <div class="course-dot \${course.progress === 100 ? 'completed' : ''}"></div>
                  <div class="course-content">
                    <a href="https://www.futureproofmusicschool.com/path-player?courseid=\${course.id}" 
                       class="course-title" 
                       target="_blank" 
                       rel="noopener noreferrer">
                      \${course.title}
                    </a>
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: \${course.progress}%"></div>
                    </div>
                  </div>
                </div>
              \`;
            });

            container.innerHTML = html;

            // Add total progress after courses are loaded
            const totalProgressContainer = document.getElementById('total-progress-container');
            totalProgressContainer.innerHTML = \`
              <div class="total-progress">
                <strong>Total Progress: \${data.totalProgress}%</strong>
                <div class="total-progress-bar">
                  <div class="total-progress-fill" style="width: \${data.totalProgress}%"></div>
                </div>
              </div>
            \`;

            sendHeight();
          })
          .catch(err => {
            console.error('Error:', err);
          });

        function sendHeight() {
          const totalHeight = document.body.offsetHeight;
          window.parent.postMessage({ type: 'resize', height: totalHeight }, '*');
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
    const apiUrl = `https://futureproofmusicschool.com/admin/api/v2/users/${userId}/progress`;
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
      throw new Error(`Failed to fetch progress: ${await progressResponse.text()}`);
    }

    const data = await progressResponse.json();
    
    // Update progress in Google Sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E',  // Changed to include column E
    });

    const values = response.data.values || [];
    console.log('Current sheet data:', values);

    const updates = [];

    // For each course in the API response, update its progress in the sheet
    data.data.forEach(course => {
      console.log('Processing course:', course);
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
      }
    });

    console.log('Updates to make:', updates);

    // Batch update the progress values
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
      console.log('Updated sheet with progress values');
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching/storing progress:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 