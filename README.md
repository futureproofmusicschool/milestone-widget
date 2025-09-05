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
  - Overview (Milestone 0) auto-completes on first view

## Progress JSON Schema

The progress tracking (column F) uses this structure:

```json
{
  "userId": "string",
  "currentMilestone": 2,
  "milestonesCompleted": [0, 1],
  "milestoneProgress": {
    "0": {
      "completed": true,
      "completedDate": "2024-04-14T09:00:00Z"
    },
    "1": {
      "completed": true,
      "completedDate": "2024-04-15T10:00:00Z"
    }
  }
}
```

### Progress Logic
- **First Visit**: New users start at Milestone 1 (Overview auto-completes on first view)
- **Current Milestone**: Always the next milestone after the highest completed one
- **Milestone Completion**: Automatically marked complete when the associated LearnWorlds course reaches 100% completion
- **Overview Auto-Complete**: Milestone 0 (Overview) automatically completes when first viewed
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
- Automatic milestone completion when associated course is completed
- Overview (Milestone 0) auto-completes on first view
- Live progress for the recommended course (if provided)

## API Endpoints

### General
- `/` – Health check (JSON)
- `/api/health` – API health (JSON)

### Milestone Journey
- `/milestone-roadmap/:userId` – HTML widget
- `/api/milestone-roadmap/:userId` – Plan + progress (JSON)
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
- Column F: `roadmap_progress` (JSON)

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
The widget shows the next milestone after the highest completed one. This provides a clear, linear progression through the learning journey.

### Progression Rules
- **First Visit**: Shows Milestone 1 (Overview auto-completes)
- **Current Logic**: Always the next milestone after the highest completed one
- **Course Completion**: When a course reaches 100% completion in LearnWorlds, the associated milestone is automatically marked complete
- **Auto-Advancement**: System automatically advances to the next milestone after completion
- **Self‑paced**: No time limits
- **Course Integration**: Celebrates course completion and prompts advancement to next milestone
- **Simple Progression**: No visit tracking - only tracks completed milestones

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

## 🎯 MILESTONE 10 COMPLETION - IMPLEMENTATION PLAN

### Current State (Issues)
When a user completes Milestone 10:
- ❌ Current milestone stays at "10 of 10" forever
- ❌ No celebration or acknowledgment of journey completion
- ❌ "Continue to Next Milestone" button does nothing (just logs to console)
- ❌ User is stuck with no clear next steps
- ❌ No summary of achievements or progress

### Proposed Solution

#### 1. **Completion Detection & State**
- Add a `journeyCompleted` flag to progress JSON
- Detect when Milestone 10 is marked complete
- Set special state: `currentMilestone: "completed"` or `11` to indicate journey end
- Store completion date for the entire journey

#### 2. **Celebration View**
Create a special completion screen that shows when all milestones are done:

**Header Section:**
- 🎉 Large celebration emoji/animation
- "Congratulations, [Username]!"
- "You've Completed Your Darkwave Journey!"

**Achievement Summary:**
- Total milestones completed: 10/10
- Journey duration (from first milestone to last)
- Courses completed count
- Key skills acquired (pulled from milestone goals)

**Visual Journey Recap:**
- Compact timeline showing all 10 completed milestones
- Each with ✅ and completion date
- Highlight major achievements

**Personalized Message:**
- Reference their northstar goal from the plan
- "You've achieved: [northstar goal]"
- Motivational message about their transformation

#### 3. **Next Steps Section**
Provide clear guidance on what to do after completion:

**Option A - Advanced Learning:**
- Link to advanced courses or masterclasses
- Suggest specialization paths
- Community challenges or competitions

**Option B - Community Engagement:**
- Join alumni network
- Become a mentor for new students
- Share your journey/portfolio

**Option C - Professional Development:**
- Portfolio building guidance
- Industry connections
- Performance/release opportunities

#### 4. **UI/UX Changes**

**Navigation Updates:**
- Change "Current Milestone: 10 of 10" to "Journey Complete! 🎉"
- Hide or disable "Continue to Next Milestone" button
- Add "View Completion Certificate" or similar CTA

**My Path View:**
- All milestones show as completed with ✅
- Add completion badge/stamp at the end of timeline
- Show journey statistics at bottom

**Milestone Detail View:**
- When viewing Milestone 10 after completion, show special completion banner
- Include option to "View Journey Summary"

#### 5. **Technical Implementation**

**Backend Changes:**
```javascript
// In /api/milestone-roadmap/:userId/complete endpoint
if (milestoneNumber === 10) {
  progress.journeyCompleted = true;
  progress.completionDate = new Date().toISOString();
  progress.currentMilestone = "completed"; // or 11
}

// New endpoint for completion data
app.get('/api/milestone-roadmap/:userId/completion-summary', async (req, res) => {
  // Return journey statistics, achievements, next steps
});
```

**Frontend Changes:**
```javascript
// Detect completion state
if (progress.journeyCompleted || progress.currentMilestone === "completed") {
  showCompletionView();
}

// New function
function showCompletionView() {
  // Render celebration screen
  // Calculate journey statistics
  // Display achievements
  // Show next steps
}
```

#### 6. **Data Schema Updates**

**Progress JSON Enhancement:**
```json
{
  "userId": "string",
  "currentMilestone": "completed", // or 11
  "journeyCompleted": true,
  "completionDate": "2024-12-15T10:00:00Z",
  "milestonesCompleted": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "journeyStats": {
    "startDate": "2024-01-15T10:00:00Z",
    "endDate": "2024-12-15T10:00:00Z",
    "totalDuration": "11 months",
    "coursesCompleted": 10
  }
}
```

#### 7. **Optional Enhancements**

**Gamification:**
- Achievement badges for completing milestones
- Special badge for journey completion
- Shareable completion certificate

**Social Features:**
- Share completion on social media
- Post to community feed
- Inspire other students

**Analytics:**
- Track completion rates
- Average time to complete journey
- Identify common drop-off points

### Implementation Priority

**Phase 1 (MVP):** 
- Completion detection
- Basic celebration screen
- Fix "stuck at 10" issue

**Phase 2:**
- Journey summary/statistics
- Next steps guidance
- UI polish

**Phase 3:**
- Certificates/badges
- Social sharing
- Advanced analytics

### Success Criteria
- ✅ Users see clear celebration when completing Milestone 10
- ✅ No confusion about what to do next
- ✅ Sense of achievement and closure
- ✅ Clear path forward after completion
- ✅ Proper state management (not stuck at "10 of 10")

---

This README reflects the current production behavior of the Milestone Widget and planned enhancements for journey completion.