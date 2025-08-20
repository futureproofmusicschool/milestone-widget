# Learn Pathway Widget

A server-rendered widget that displays learning pathways and course progress. The widget is served directly from an Express server without a separate React frontend.

**New Feature**: 12-Milestone Learning Journey Roadmap - A personalized, self-paced learning path with milestone tracking.


## Project Structure

- `server.js` - Express server that handles API requests and serves the HTML widget
- `vercel.json` - Vercel deployment configuration
- `.env` - Environment variables (Google Sheets credentials, etc.)
- Package files (`package.json`, `package-lock.json`, `.npmrc`) - Node.js dependencies

## Tech Stack

- Express.js - Server with CORS support for multiple domains
- Google Sheets API - Data storage
- LearnWorlds API - Course progress tracking via OAuth2
- Vanilla JavaScript - Client-side interactivity
- HTML/CSS - Widget rendering with responsive design


## Widgets

### 1. Course Roadmap Widget (`/roadmap/:userId`)
Displays a user's learning pathway with course progress in a timeline format.

**Features:**
- Course progress tracking with visual timeline
- Add/remove courses functionality
- Real-time progress updates from LearnWorlds API

### 2. Milestone Journey Widget (`/milestone-roadmap/:userId`) 🆕
Displays a personalized 12-milestone learning journey with self-paced progression.

**Features:**
- Visual timeline with 12 milestones  
- Current milestone detail view with practice
- Toggle between current milestone and full path view
- Mark milestone complete functionality
- Course recommendations with automatic progress tracking
- Real-time progress display for recommended courses
- Progress tracking saved to Google Sheets



## API Endpoints

### Course Roadmap APIs
- `/roadmap/:userId` - Get the HTML widget for a specific user
- `/api/roadmap/:userId` - Get a user's saved courses (JSON)
- `/api/roadmap/:userId/add` - Add a course to a user's roadmap
- `/api/roadmap/:userId/remove` - Remove a course from a user's roadmap
- `/api/progress/:userId` - Proxy LearnWorlds API for progress data
- `/api/roadmapData/:userId` - Get complete roadmap data including progress (JSON)

### Milestone Journey APIs 🆕
- `/milestone-roadmap/:userId` - Get the HTML widget for milestone journey
- `/api/milestone-roadmap/:userId` - Get user's roadmap plan and progress (JSON)
- `/api/milestone-roadmap/:userId/complete` - Mark a milestone as complete
- `/api/course-progress/:userId/course/:courseId` - Get progress for a specific course

### Debug Endpoints
- `/api/debug/oauth` - Test OAuth connection and credentials

## Data Sources

### Course Roadmap Data
- **SPREADSHEET_ID**: Main spreadsheet for course tracking
  - Sheet1: Course data (userId, courseId, courseTitle, timestamp, progress)
  - Sheet2: Course sort order (courseId, sortOrder)

### Milestone Journey Data 🆕
- **MILESTONE_SPREADSHEET_ID**: Milestone tracking spreadsheet (defaults to SPREADSHEET_ID if not set)
  - Column A: User ID
  - Column B: Username
  - Column E: Roadmap plan (JSON from AI generation)
  - Column F: Roadmap progress (JSON tracking completion)


## Embedding the Widgets

### Course Roadmap Widget
```html
<iframe src="https://learn-pathway-widget.vercel.app/roadmap/{{USER.ID}}?username={{USER.USERNAME}}" 
        width="100%" 
        height="800" 
        frameborder="0">
</iframe>
```

### Milestone Journey Widget 🆕
```html
<iframe src="https://learn-pathway-widget.vercel.app/milestone-roadmap/{{USER.ID}}?username={{USER.USERNAME}}" 
        width="100%" 
        height="800" 
        frameborder="0">
</iframe>
```

For standalone deployment:
```html
<iframe src="https://milestone-widget.vercel.app/milestone-roadmap/{{USER.ID}}?username={{USER.USERNAME}}" 
        width="100%" 
        height="800" 
        frameborder="0">
</iframe>
```

Both widgets automatically adjust their height and communicate with the parent frame for optimal display.

## Setup and Development

1. Install dependencies:
```
npm install
```

2. Set up environment variables in `.env`:
```
GOOGLE_CREDENTIALS={"type":"service_account",...}
SPREADSHEET_ID=your_course_spreadsheet_id
MILESTONE_SPREADSHEET_ID=your_milestone_spreadsheet_id (optional, defaults to SPREADSHEET_ID)
LEARNWORLDS_CLIENT_ID=your_learnworlds_oauth_client_id
LEARNWORLDS_CLIENT_SECRET=your_learnworlds_oauth_client_secret
VERCEL_PROTECTION_BYPASS=your_bypass_token (optional)
```

**Important Notes:**
- Use OAuth2 client credentials from LearnWorlds, NOT static access tokens
- The OAuth token endpoint is: `https://{SCHOOLHOMEPAGE}/admin/api/oauth2/access_token`
- Both deployments (main app and milestone widget) need the same environment variables

3. Run the server:
```
node server.js
```

