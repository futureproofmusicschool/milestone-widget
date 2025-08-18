# Learn Pathway Widget

A server-rendered widget that displays learning pathways and course progress. The widget is served directly from an Express server without a separate React frontend.

**New Feature**: 12-Milestone Learning Journey Roadmap - A personalized, self-paced learning path with milestone tracking.

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
- Current milestone detail view with weekly practices
- Mark milestone complete functionality
- Course recommendations per milestone
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

## Data Sources

### Course Roadmap Data
- **SPREADSHEET_ID**: Main spreadsheet for course tracking
  - Sheet1: Course data (userId, courseId, courseTitle, timestamp, progress)
  - Sheet2: Course sort order (courseId, sortOrder)

### Milestone Journey Data 🆕
- **FMS_Users Sheet**: Main user data spreadsheet
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
LEARNWORLDS_ACCESS_TOKEN=your_learnworlds_token
LEARNWORLDS_CLIENT_ID=your_learnworlds_client_id
VERCEL_PROTECTION_BYPASS=your_bypass_token
```

3. Run the server:
```
node server.js
```

