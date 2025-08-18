# Learn Pathway Widget

A server-rendered widget that displays learning pathways and course progress. The widget is served directly from an Express server without a separate React frontend.

## Project Structure

- `server.js` - Express server that handles API requests and serves the HTML widget
- `vercel.json` - Vercel deployment configuration
- `.env` - Environment variables (Google Sheets credentials, etc.)
- Package files (`package.json`, `package-lock.json`, `.npmrc`) - Node.js dependencies

## Tech Stack

- Express.js - Server
- Google Sheets API - Data storage
- Vanilla JavaScript - Client-side interactivity
- HTML/CSS - Widget rendering

## Widget

### Course Roadmap Widget (`/roadmap/:userId`)
Displays a user's learning pathway with course progress in a timeline format.

**Features:**
- Course progress tracking with visual timeline
- Add/remove courses functionality
- Real-time progress updates from LearnWorlds API



## API Endpoints

### Course Roadmap APIs
- `/roadmap/:userId` - Get the HTML widget for a specific user
- `/api/roadmap/:userId` - Get a user's saved courses (JSON)
- `/api/roadmap/:userId/add` - Add a course to a user's roadmap
- `/api/roadmap/:userId/remove` - Remove a course from a user's roadmap
- `/api/progress/:userId` - Proxy LearnWorlds API for progress data
- `/api/roadmapData/:userId` - Get complete roadmap data including progress (JSON)

## Data Sources

### Course Roadmap Data
- **SPREADSHEET_ID**: Main spreadsheet for course tracking
  - Sheet1: Course data (userId, courseId, courseTitle, timestamp, progress)
  - Sheet2: Course sort order (courseId, sortOrder)


## Embedding the Widget

### Course Roadmap Widget
```html
<iframe src="https://your-domain.vercel.app/roadmap/{{USER.ID}}?username={{USER.USERNAME}}" 
        width="100%" 
        height="800" 
        frameborder="0">
</iframe>
```

The widget automatically adjusts its height and communicates with the parent frame for optimal display.

## Setup and Development

1. Install dependencies:
```
npm install
```

2. Set up environment variables in `.env`:
```
GOOGLE_CREDENTIALS={"type":"service_account",...}
SPREADSHEET_ID=your_course_spreadsheet_id
LEARNWORLDS_ACCESS_TOKEN=your_learnworlds_token
LEARNWORLDS_CLIENT_ID=your_learnworlds_client_id
VERCEL_PROTECTION_BYPASS=your_bypass_token
```

3. Run the server:
```
node server.js
```

