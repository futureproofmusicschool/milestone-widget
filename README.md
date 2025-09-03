# Learn Pathway & Milestone Widget

A server-rendered widget suite (no separate React app) that displays learning pathways, a 12‑milestone self‑paced journey, and real‑time course progress. Served directly from an Express server.

## What's Included

- Course Roadmap widget: saves and displays a user's selected courses with progress
- Milestone Journey widget: shows a personalized, self‑paced 12‑milestone journey with current milestone focus and course recommendation
- LearnWorlds OAuth2 integration for live course progress
- Google Sheets as the data store for plans and progress

## How It Works


### Data Flow (Milestone Journey)
- Plan JSON (the 12‑milestone roadmap) is stored in Google Sheets under `MILESTONE_SPREADSHEET_ID`, tab `sheet1`, column E.
- Progress JSON (completion state) is stored in the same sheet, column F.
- The server renders the Milestone widget (`/milestone-roadmap/:userId`) which:
  - Loads the plan/progress via `/api/milestone-roadmap/:userId`
  - Renders a header, current milestone detail, and a vertical timeline
  - Optionally shows a recommended course with live progress via `/api/course-progress/:userId/course/:courseId`
  - Lets users mark a milestone complete via `/api/milestone-roadmap/:userId/complete`

### Data Flow (Course Roadmap)
- A separate spreadsheet (`SPREADSHEET_ID`) stores a user’s added courses (Sheet1) and canonical sort order (Sheet2).
- The server renders the Course Roadmap widget (`/roadmap/:userId`) and pulls data via `/api/roadmapData/:userId` with live LearnWorlds progress available via `/api/progress/:userId`.

## Progress JSON Schema (Milestone Journey)

The progress tracking (column F) uses this enhanced structure:

```json
{
  "userId": "string",
  "currentMilestone": 0,
  "milestonesCompleted": [1, 2, 3],
  "milestonesVisited": [0, 1, 2, 3, 4],
  "milestoneProgress": {
    "1": {
      "completed": true,
      "completedDate": "2024-04-15T10:00:00Z",
      "visitedDate": "2024-04-14T09:00:00Z"
    }
  }
}
```

### Progress Logic
- **First Visit**: New users start with Overview (Milestone 0)
- **Visit Tracking**: Each milestone navigation is saved to `milestonesVisited`
- **Current Milestone**: Shows the most advanced visited but not completed milestone
- **Auto-Advancement**: When all visited milestones are complete, advances to next milestone

## Plan JSON Schema (Milestone Journey)

The plan JSON (column E) expects this shape:

```json
{
  "northstar": "string",
  "welcome": "string",
  "overview": "string",
  "milestones": [
    {
      "number": 1,
      "focus": "string",
      "goal": "string",
      "course_rec": { "title": "string", "url": "string", "benefit": "string" }
    }
    // ... 12 total entries, ordered as Milestones 1..12
  ],
  "quarters": { "Q1": "string", "Q2": "string", "Q3": "string", "Q4": "string" },
  "kpi": ["string", "string", "string", "string"],
  "support_channels": ["string", "string"]
}
```

Notes:
- The `milestones` array contains the 12 milestones (indexed as Milestones 1..12 in the UI).
- The `number` field represents the milestone number (1-12).
- The `goal` field is outcome‑based and must start with "Be able to …". It's a capability statement (not an instruction).
- The `quarters` object divides the journey into quarters (Q1: Milestones 1-3, Q2: Milestones 4-6, Q3: Milestones 7-9, Q4: Milestones 10-12).
- The former `explanation` field is removed everywhere.

## Features

### Course Roadmap (`/roadmap/:userId`)
- Visual timeline of saved courses
- Add/remove courses
- Live progress from LearnWorlds

### Milestone Journey (`/milestone-roadmap/:userId`)
- Self‑paced 12‑milestone journey
- Current milestone detail view with: focus, outcome goal, and course recommendation
- Toggle between "Current" and "My Path" views
- Mark milestone complete (stored in Sheets)
- Live progress for the recommended course (if provided)

## API Endpoints

### General
- `/` – Health check (JSON)
- `/api/health` – API health (JSON)

### Course Roadmap
- `/roadmap/:userId` – HTML widget
- `/api/roadmap/:userId` – Saved courses (JSON)
- `/api/roadmap/:userId/add` – Add course
- `/api/roadmap/:userId/remove` – Remove course
- `/api/roadmapData/:userId` – Full roadmap data (JSON)
- `/api/progress/:userId` – Sync LearnWorlds progress (batch)

### Milestone Journey
- `/milestone-roadmap/:userId` – HTML widget
- `/api/milestone-roadmap/:userId` – Plan + progress (JSON)
- `/api/milestone-roadmap/:userId/visit` – Track milestone visit (POST)
- `/api/milestone-roadmap/:userId/complete` – Mark milestone complete (POST)
- `/api/course-progress/:userId/course/:courseId` – Per‑course progress (LearnWorlds)

### Debug
- `/api/debug/oauth` – Verify LearnWorlds OAuth credentials

## Data Sources

### Course Roadmap Sheets (SPREADSHEET_ID)
- Sheet1: `userId, courseId, courseTitle, timestamp, progress`
- Sheet2: `courseId, sortOrder` (used for canonical ordering)

### Milestone Journey Sheet (MILESTONE_SPREADSHEET_ID)
- Column A: `user_id`
- Column B: `username`
- Column E: `roadmap_plan` (JSON)
- Column F: `roadmap_progress` (JSON with visit tracking)

## Tech Stack

- Express.js with CORS
- Google Sheets API
- LearnWorlds API (OAuth2 client credentials)
- HTML/CSS + Vanilla JS (no frontend framework)

## Embedding

### Course Roadmap
```html
<iframe src="https://learn-pathway-widget.vercel.app/roadmap/{{USER.ID}}?username={{USER.USERNAME}}"
        width="100%" height="800" frameborder="0"></iframe>
```

### Milestone Journey
```html
<iframe src="https://learn-pathway-widget.vercel.app/milestone-roadmap/{{USER.ID}}?username={{USER.USERNAME}}"
        width="100%" height="800" frameborder="0"></iframe>
```

Standalone deployment:
```html
<iframe src="https://milestone-widget.vercel.app/milestone-roadmap/{{USER.ID}}?username={{USER.USERNAME}}"
        width="100%" height="800" frameborder="0"></iframe>
```

Both widgets auto‑size using `postMessage` to the parent frame.

## Setup

1) Install dependencies
```bash
npm install
```

2) Environment variables (`.env`)
```bash
GOOGLE_CREDENTIALS={"type":"service_account",...}
SPREADSHEET_ID=your_course_spreadsheet_id
MILESTONE_SPREADSHEET_ID=your_milestone_spreadsheet_id   # optional; defaults to SPREADSHEET_ID
LEARNWORLDS_CLIENT_ID=your_learnworlds_oauth_client_id
LEARNWORLDS_CLIENT_SECRET=your_learnworlds_oauth_client_secret
VERCEL_PROTECTION_BYPASS=your_bypass_token                # optional
```

Notes:
- Use OAuth2 client credentials (not static tokens)
- Token endpoint: `https://{SCHOOLHOMEPAGE}/admin/api/oauth2/access_token`

3) Run locally
```bash
node server.js
```

## Milestone Logic (Renderer)

### Current Milestone
The widget shows the most advanced milestone that the user has visited but not yet completed. This ensures users return to where they left off in their learning journey.

### Progression Rules
- **First Visit**: Shows Overview (Milestone 0)
- **Visit Tracking**: Each milestone navigation is recorded
- **Current Logic**: Most advanced visited but incomplete milestone
- **Auto-Advancement**: When all visited milestones complete, advances to next
- **Self‑paced**: No time limits
- **Flexible completion**: Can mark complete at any time
- **Course Integration**: Celebrates course completion and prompts advancement

## Visual Style

- Black background with purple accent (`#A373F8`)
- Subtle borders and glassy panels
- Mobile‑optimized layout

## Success Metrics (suggested)
- Widget loads < 2s
- Progress saves reliably
- Accurate LearnWorlds progress
- Mobile responsiveness

---

This README merges and replaces prior high‑level docs, reflecting the current production behavior of the widgets and APIs.