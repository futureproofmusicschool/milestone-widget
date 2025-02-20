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
      range: 'Sheet1!A:B',  // Just get user_id and course_id columns
    });

    // Filter for just this user's courses
    const userCourses = (response.data.values || [])
      .filter(row => row[0] === userId)
      .map(row => row[1]); // Get just the course_ids

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

    // Append with title
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:D',
      valueInputOption: 'RAW',
      resource: {
        values: [[userId, courseId, courseTitle, new Date().toISOString()]]
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

// Add this near your other routes
app.get('/roadmap/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const username = decodeURIComponent(req.query.username || '') || 'Student';
    
    // Get user's courses from the sheet - update range to get title
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:D', // Changed from A:C to A:D to include all columns
    });

    // Filter and map to get id and title from correct columns
    const userCourses = (response.data.values || [])
      .filter(row => row[0] === userId)
      .map(row => ({
        id: row[1],
        title: row[2] || row[1] // Title is in column C (index 2)
      }));

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
              background: #000000; /* Body background */
              color: #F6F8FF; /* Light text */
            }
            h1 {
              text-align: center;
              color: #F6F8FF;
              text-transform: uppercase;
              margin: 40px 0;
              font-size: 2.1em; /* Reduced from 2.5em */
              font-weight: 700;
            }
            .course-list {
              background: #111111; /* Light background */
              border-radius: 8px;
              padding: 20px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            .course-item {
              padding: 15px;
              border-bottom: 1px solid #A373F8; /* Accent 1 */
              font-size: 1.1em;
              color: #F6F8FF; /* Light text */
            }
            .course-item:last-child {
              border-bottom: none;
            }
            .empty-message {
              text-align: center;
              color: #BBBDC5; /* Accent 2 */
              font-style: italic;
              padding: 40px 0;
            }
            .course-item:hover {
              background: #A373F8; /* Accent 1 */
              color: #000000; /* Dark text */
              border-radius: 4px;
              transition: all 0.2s ease;
            }
            .course-item a {
              color: #F6F8FF;
              text-decoration: none;
              display: block;
              width: 100%;
              height: 100%;
            }
            .course-item:hover a {
              color: #000000;
            }
          </style>
        </head>
        <body>
          <h1>Course Roadmap for ${username}</h1>
          <div class="course-list">
            ${userCourses.length > 0 
              ? userCourses.map(course => `
                  <div class="course-item">
                    <a href="https://futureproofmusicschool.com/path-player?courseid=${course.id}" 
                       target="_blank" 
                       rel="noopener noreferrer">
                      ${course.title}
                    </a>
                  </div>
                `).join('')
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