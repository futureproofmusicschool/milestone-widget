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
  origin: ['https://www.futureproofmusicschool.com', 'https://learn.futureproofmusicschool.com'],
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
  expiryTime: 1000 * 60 * 5 // Cache for 5 minutes (reduced from 1 hour)
};

// Clear cache on server start to ensure fresh data
console.log('Clearing sort order cache on server start');
sortOrderCache.data = null;
sortOrderCache.lastFetch = 0;

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
              container.innerHTML = '<div style="text-align: center; padding: 30px 20px; color: #FFFFFF;"><p>No courses added yet.</p><p>Use the Add/Remove buttons on the course cards below to add courses to your Course Roadmap.</p></div>';
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 