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
    const { courseId } = req.body;

    // Append the new course preference
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:C',
      valueInputOption: 'RAW',
      resource: {
        values: [[userId, courseId, new Date().toISOString()]]
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
    
    // Get current data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:C',
    });

    // Find the row to remove
    const values = response.data.values || [];
    const rowIndex = values.findIndex(row => 
      row[0] === userId && row[1] === courseId
    );

    if (rowIndex !== -1) {
      // Clear the row (Google Sheets doesn't have a true delete, so we clear it)
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!A${rowIndex + 1}:C${rowIndex + 1}`,
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
    
    // Get user's courses from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:B',
    });

    // Filter for this user's courses
    const userCourses = (response.data.values || [])
      .filter(row => row[0] === userId)
      .map(row => row[1]);

    // Render a simple HTML page
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Course Roadmap</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background: #f5f5f5;
            }
            h1 {
              text-align: center;
              color: #333;
              text-transform: uppercase;
              margin: 40px 0;
              font-size: 2.5em;
              font-weight: 700;
            }
            .course-list {
              background: white;
              border-radius: 8px;
              padding: 20px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .course-item {
              padding: 15px;
              border-bottom: 1px solid #eee;
              font-size: 1.1em;
            }
            .course-item:last-child {
              border-bottom: none;
            }
            .empty-message {
              text-align: center;
              color: #666;
              font-style: italic;
              padding: 40px 0;
            }
          </style>
        </head>
        <body>
          <h1>Course Roadmap for ${userId}</h1>
          <div class="course-list">
            ${userCourses.length > 0 
              ? userCourses.map(course => `
                  <div class="course-item">
                    ${course}
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