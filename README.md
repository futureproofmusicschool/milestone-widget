# Milestone Widget

A server-rendered widget that displays a personalized, self‑paced 10‑milestone learning journey with real‑time course progress. Served directly from an Express server.

## What's Included

- Milestone Journey widget: shows a personalized, self‑paced 10‑milestone journey with current milestone focus and course recommendation
- LearnWorlds OAuth2 integration for live course progress
- Google Sheets as the data store for plans and progress

## How It Works

### Data Flow
- Plan JSON (the 10‑milestone roadmap) is stored in Google Sheets under `MILESTONE_SPREADSHEET_ID`, tab `sheet1`, column E.
- Progress JSON (completion state) is stored in the same sheet, column F.
- The server renders the Milestone widget (`/milestone-roadmap/:userId`) which:
  - Loads the plan/progress via `/api/milestone-roadmap/:userId`
  - Renders a header, current milestone detail, and a vertical timeline
  - Shows a recommended course with live progress via `/api/course-progress/:userId/course/:courseId`
  - Automatically marks milestones complete when their associated course is completed
  - Tracks milestone visits via `/api/milestone-roadmap/:userId/visit`

## Progress JSON Schema

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
- **Current Milestone**: Automatically calculated as the lowest visited (but not completed) milestone
- **Milestone Completion**: Automatically marked complete when the associated LearnWorlds course reaches 100% completion
- **Automatic Advancement**: When a milestone is completed, the system advances to the next milestone

## Plan JSON Schema

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
    // ... 10 total entries, ordered as Milestones 1..10
  ],
  "halves": { "H1": "string", "H2": "string" },
  "kpi": ["string", "string", "string", "string"],
  "support_channels": ["string", "string"]
}
```

Notes:
- The `milestones` array contains the 10 milestones (indexed as Milestones 1..10 in the UI).
- The `number` field represents the milestone number (1-10).
- The `goal` field is outcome‑based and must start with "Be able to …". It's a capability statement (not an instruction).
- The `halves` object divides the journey into halves (H1: Milestones 1-5, H2: Milestones 6-10).

## Features

### Milestone Journey (`/milestone-roadmap/:userId`)
- Self‑paced 10‑milestone journey
- Current milestone detail view with: focus, outcome goal, and course recommendation
- Toggle between "Current" and "My Path" views
- Automatic milestone visit tracking (stored in Sheets)
- Automatic milestone completion when associated course is completed
- Live progress for the recommended course (if provided)

## API Endpoints

### General
- `/` – Health check (JSON)
- `/api/health` – API health (JSON)

### Milestone Journey
- `/milestone-roadmap/:userId` – HTML widget
- `/api/milestone-roadmap/:userId` – Plan + progress (JSON)
- `/api/milestone-roadmap/:userId/visit` – Track milestone visit (POST)
- `/api/milestone-roadmap/:userId/complete` – Mark milestone as complete (POST)
- `/api/course-progress/:userId/course/:courseId` – Per‑course progress (LearnWorlds)

### Debug
- `/api/debug/oauth` – Verify LearnWorlds OAuth credentials
- `/api/milestone-debug/:userId` – Debug milestone data parsing

## Data Sources

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

### Milestone Journey
```html
<iframe src="https://milestone-widget.vercel.app/milestone-roadmap/{{USER.ID}}?username={{USER.USERNAME}}"
        width="100%" height="800" frameborder="0"></iframe>
```

The widget auto‑sizes using `postMessage` to the parent frame.

## Setup

1) Install dependencies
```bash
npm install
```

2) Environment variables (`.env`)
```bash
GOOGLE_CREDENTIALS={"type":"service_account",...}
MILESTONE_SPREADSHEET_ID=your_milestone_spreadsheet_id
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
- **Visit Tracking**: Each milestone navigation is recorded automatically
- **Current Logic**: Most advanced visited but incomplete milestone
- **Course Completion**: When a course reaches 100% completion in LearnWorlds, the associated milestone is automatically marked complete
- **Auto-Advancement**: System automatically advances to the next milestone after completion
- **Self‑paced**: No time limits
- **Course Integration**: Celebrates course completion and prompts advancement to next milestone

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

This README reflects the current production behavior of the Milestone Widget.