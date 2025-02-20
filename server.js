import { config } from 'dotenv';
import express from 'express';
import { google } from 'googleapis';
import bodyParser from 'body-parser';
import cors from 'cors';

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
        // Add Getting Started course with initial progress
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A:E',
          valueInputOption: 'RAW',
          resource: {
            values: [[
              userId,
              'getting-started',
              'Getting Started',
              '0', // Initial progress
              new Date().toISOString()
            ]]
          }
        });
        
        // Add it to our current results
        userRows.push([userId, 'getting-started', 'Getting Started', '0', new Date().toISOString()]);
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
    const { courseId, courseTitle, progress } = req.body;

    // Append without description
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E', // Changed from A:F to A:E (removed description column)
      valueInputOption: 'RAW',
      resource: {
        values: [[
          userId,
          courseId,
          courseTitle,
          progress,
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

// Update the roadmap endpoint to handle progress updates
app.get('/roadmap/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const username = decodeURIComponent(req.query.username || '') || 'Student';
    
    // Get course progress from LearnWorlds
    const courseProgress = req.query.progress ? JSON.parse(req.query.progress) : {};
    
    // Update progress in spreadsheet
    await updateCourseProgress(userId, courseProgress);
    
    // Get user's courses from the sheet - use full range to ensure we get progress
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:E', // Changed from A:D to A:E to ensure we get all columns
    });

    // Filter and map user's courses
    let userCourses = (response.data.values || [])
      .filter(row => row[0] === userId)
      .map(row => ({
        id: row[1],
        title: row[2] || row[1],
        progress: parseInt(row[3] || '0', 10)
      }));

    // Check if Getting Started course exists in the list
    const existingGettingStarted = userCourses.find(course => course.id === 'getting-started');
    
    // If not in list, look for it in ALL rows for this user
    if (!existingGettingStarted) {
      const gettingStartedRow = response.data.values
        ?.filter(row => row[0] === userId) // Filter for this user's rows
        ?.find(row => row[1] === 'getting-started'); // Find Getting Started among their courses

      if (gettingStartedRow) {
        // If found in sheet, add with actual progress
        userCourses.unshift({
          id: 'getting-started',
          title: 'Getting Started',
          progress: parseInt(gettingStartedRow[3] || '0', 10)
        });
        console.log('Found Getting Started progress:', gettingStartedRow[3]); // Debug log
      } else {
        // If not found at all, add with default values
        userCourses.unshift({
          id: 'getting-started',
          title: 'Getting Started',
          progress: 0
        });
      }
    }

    // Calculate average progress including Getting Started course
    const totalProgress = userCourses.length > 0
      ? Math.round(userCourses.reduce((sum, course) => sum + course.progress, 0) / userCourses.length)
      : 0;

    // Render a simple HTML page with your brand colors
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Course Roadmap</title>
          <link href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Source Sans Pro', -apple-system, BlinkMacSystemFont, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background: #000000;
              color: #F6F8FF;
            }
            h1 {
              text-align: center;
              color: #F6F8FF;
              text-transform: uppercase;
              margin: 40px 0;
              font-size: 1.7em;
              font-weight: 700;
            }
            .course-list {
              background: #111111;
              border-radius: 8px;
              padding: 20px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            .course-item {
              padding: 15px 20px;
              font-size: 1.1em;
              color: #F6F8FF;
              display: flex;
              justify-content: space-between;
              align-items: center;
              transition: all 0.3s ease;
            }
            .course-item:hover {
              background: #A373F8;
              border-radius: 8px;
              transform: translateX(5px);
            }
            .course-title {
              font-weight: 600;
              margin-right: 20px;
            }
            .course-progress {
              font-size: 0.9em;
              color: #A373F8;
              white-space: nowrap;
            }
            .course-item:hover .course-progress {
              color: #000000;
            }
            .course-item a {
              color: inherit;
              text-decoration: none;
              display: flex;
              justify-content: space-between;
              align-items: center;
              width: 100%;
            }
            .empty-message {
              text-align: center;
              color: #BBBDC5;
              font-style: italic;
              padding: 40px 0;
            }
            .total-progress-container {
              margin-top: 20px;
              padding: 15px 20px;
              display: flex;
              justify-content: flex-end;
              align-items: center;
            }
            .total-progress {
              font-size: 1.3em;
              color: #FFFFFF;
              font-weight: 600;
              white-space: nowrap;
            }
          </style>
        </head>
        <body>
          <h1>Course Roadmap for ${username}</h1>
          <div class="course-list">
            ${userCourses.length > 0 
              ? `
                ${userCourses.map(course => `
                  <div class="course-item">
                    <a href="https://futureproofmusicschool.com/path-player?courseid=${course.id}" 
                       target="_blank" 
                       rel="noopener noreferrer">
                      <span class="course-title">${course.title}</span>
                      <span class="course-progress">${course.progress}% Complete</span>
                    </a>
                  </div>
                `).join('')}
                <div class="total-progress-container">
                  <span class="total-progress">Total Progress: ${totalProgress}% Complete</span>
                </div>
                `
              : '<div class="empty-message">No courses added to roadmap yet.</div>'
            }
          </div>
        </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error('Error fetching roadmap:', err);
    res.status(500).send('Error loading roadmap');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 