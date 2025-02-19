require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create a Supabase client instance using the service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Endpoint: GET /api/roadmap/:userId
 * - Retrieves the student's saved courses from the 'student_roadmap' table.
 * - You should verify the user's identity with a proper authentication check here (e.g., validate a JWT or session cookie).
 */
app.get('/api/roadmap/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    // TODO: Add authentication verification here to ensure the user is allowed to access this data.
    
    const { data, error } = await supabase
      .from('student_roadmap')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    res.status(200).json({ courses: data });
  } catch (err) {
    console.error('Error fetching roadmap data:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

/**
 * Endpoint: POST /api/roadmap/:userId/add
 * - Adds a course to the student's roadmap
 * - Make sure to securely validate and sanitize incoming data.
 */
app.post('/api/roadmap/:userId/add', async (req, res) => {
  try {
    const { userId } = req.params;
    const { courseId } = req.body;
    
    // TODO: Validate input data and implement authentication check here.

    const { data, error } = await supabase
      .from('student_roadmap')
      .insert({ user_id: userId, course_id: courseId });
    
    if (error) throw error;
    res.status(200).json({ added: data });
  } catch (err) {
    console.error('Error adding course:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 