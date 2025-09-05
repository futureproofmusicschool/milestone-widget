# Milestone Widget

A server-rendered widget that displays a personalized, self‑paced 10‑milestone learning journey with dual-track progress: course completion AND real-world goal achievement. Served directly from an Express server.

## What's Included

- Milestone Journey widget: shows a personalized, self‑paced 10‑milestone journey with current milestone focus, course recommendation, and personalized subgoal
- Dual-track progress system: tracks both course completion and assignment submissions
- LearnWorlds OAuth2 integration for live course progress and assignment tracking
- Google Sheets as the data store for plans and progress
- Personalized northstar goal calibration for achievable outcomes in 3-12 months

## How It Works

### Data Flow
- Plan JSON (the 10‑milestone roadmap with personalized subgoals) is stored in Google Sheets under `MILESTONE_SPREADSHEET_ID`, tab `sheet1`, column E.
- Progress JSON (dual-track completion state) is stored in the same sheet, column F.
- The server renders the Milestone widget (`/milestone-roadmap/:userId`) which:
  - Loads the plan/progress via `/api/milestone-roadmap/:userId`
  - Renders a header, current milestone detail, and a vertical timeline
  - Shows a recommended course with live progress via `/api/course-progress/:userId/course/:courseId`
  - Shows personalized subgoal assignment status via `/api/assignment-status/:userId/assignment/:assignmentId`
  - Marks milestones complete ONLY when BOTH course AND assignment are completed
  - Overview (Milestone 0) auto-completes on first view

### Dual-Track Completion System
Each milestone requires TWO completions:
1. **Knowledge Track**: Complete the recommended LearnWorlds course (100% progress)
2. **Application Track**: Submit and get approval for the milestone assignment in the "Milestones" course

Students must achieve both to advance to the next milestone, ensuring they not only learn concepts but also apply them toward their personalized northstar goal.

## Progress JSON Schema

The progress tracking (column F) uses this enhanced structure:

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
      "courseCompleted": true,
      "courseCompletedDate": "2024-04-15T10:00:00Z",
      "assignmentSubmitted": true,
      "assignmentApproved": true,
      "assignmentApprovedDate": "2024-04-16T10:00:00Z",
      "completed": true,
      "completedDate": "2024-04-16T10:00:00Z"
    },
    "2": {
      "courseCompleted": true,
      "courseCompletedDate": "2024-04-20T10:00:00Z",
      "assignmentSubmitted": true,
      "assignmentApproved": false,
      "completed": false
    }
  }
}
```

### Progress Logic
- **First Visit**: New users start at Milestone 1 (Overview auto-completes on first view)
- **Current Milestone**: Always the next milestone after the highest completed one
- **Dual-Track Completion**: Milestone marked complete ONLY when:
  1. Associated LearnWorlds course reaches 100% completion
  2. Milestone assignment is submitted AND approved by mentor
- **Overview Auto-Complete**: Milestone 0 (Overview) automatically completes when first viewed (no assignment required)
- **Automatic Advancement**: When both tracks of a milestone are completed, the system advances to the next milestone
- **Partial Progress**: Students can complete courses ahead of assignments, but milestone won't advance until both are done

## Plan JSON Schema

The plan JSON (column E) expects this enhanced shape with personalized northstar and subgoals:

```json
{
  "northstar": {
    "original_dream": "Become a world-famous darkwave artist",
    "achievable_goal": "Release a 5-track darkwave EP and build a community of 500 engaged fans",
    "timeframe": "3-12 months",
    "success_metrics": [
      "5 professionally produced tracks",
      "500 genuine fans across platforms",
      "3 live performances or DJ sets"
    ]
  },
  "welcome": "string",
  "overview": "string",
  "milestones": [
    {
      "number": 1,
      "focus": "Foundation Building",
      "goal": "Be able to create authentic darkwave chord progressions",
      "course_rec": {
        "title": "Music Theory Fundamentals",
        "courseId": "course_abc123",
        "url": "string",
        "benefit": "Understand the harmonic language of darkwave"
      },
      "subgoal": {
        "title": "Create your first darkwave chord progression",
        "description": "Apply music theory to create an authentic darkwave progression",
        "deliverable": "Submit a 16-bar progression with bass line",
        "alignment": "Directly applies music theory concepts from the course",
        "learnworlds_assignment_id": "assign_123"
      }
    }
    // ... 10 total entries, ordered as Milestones 1..10
  ],
  "halves": { "H1": "string", "H2": "string" },
  "kpi": ["string", "string", "string", "string"],
  "support_channels": ["string", "string"]
}
```

### Northstar Goal Calibration
- **original_dream**: The student's ultimate vision (may take years to fully achieve)
- **achievable_goal**: A realistic goal achievable in 3-12 months depending on time commitment
- **timeframe**: Expected completion timeframe ("3-12 months")
- **success_metrics**: Measurable outcomes that define success

### Milestone Structure
- **course_rec**: Recommended course with `courseId` for progress tracking
- **subgoal**: Personalized assignment that applies course knowledge toward the northstar goal
  - **title**: What the student will accomplish
  - **description**: Context and purpose
  - **deliverable**: Specific work product to submit
  - **alignment**: How it relates to the course content
  - **learnworlds_assignment_id**: ID of the assignment in the Milestones course

Notes:
- Each milestone combines knowledge acquisition (course) with practical application (subgoal)
- Subgoals progressively build toward the achievable northstar goal
- The 10th milestone's subgoal should essentially complete the northstar goal
- All subgoals are personalized based on the student's specific northstar

## Features

### Milestone Journey (`/milestone-roadmap/:userId`)
- Self‑paced 10‑milestone journey with personalized northstar goal
- Dual-track progress system:
  - **Knowledge Track**: Course completion progress
  - **Application Track**: Assignment submission and approval status
- Current milestone detail view with:
  - Focus area and outcome goal
  - Course recommendation with live progress
  - Personalized subgoal assignment aligned to northstar
- Toggle between "Current" and "My Path" views
- Milestone completion requires BOTH course completion AND assignment approval
- Overview (Milestone 0) auto-completes on first view
- Support for students who need extra help via mentor session packages

## API Endpoints

### General
- `/` – Health check (JSON)
- `/api/health` – API health (JSON)

### Milestone Journey
- `/milestone-roadmap/:userId` – HTML widget with dual-track progress
- `/api/milestone-roadmap/:userId` – Plan + progress (JSON)
- `/api/milestone-roadmap/:userId/complete` – Mark milestone as complete (POST, requires both tracks)
- `/api/course-progress/:userId/course/:courseId` – Per‑course progress (LearnWorlds)
- `/api/assignment-status/:userId/assignment/:assignmentId` – Assignment submission/approval status (LearnWorlds)

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

### Dual-Track Progression Rules
- **First Visit**: Shows Milestone 1 (Overview auto-completes)
- **Current Logic**: Always the next milestone after the highest completed one
- **Course Completion**: Track 1 - When a course reaches 100% completion in LearnWorlds
- **Assignment Approval**: Track 2 - When milestone assignment is submitted AND approved by mentor
- **Milestone Completion**: Requires BOTH tracks to be complete before marking milestone as done
- **Auto-Advancement**: System advances to next milestone only after both tracks are complete
- **Self‑paced**: No time limits, but students can work ahead on courses
- **Partial Progress Support**: Students can complete courses before assignments are approved
- **Support System**: Students struggling with assignments can purchase mentor session packages

### UI Progress Indicators
- **Course Progress Bar**: Shows percentage completion of recommended course
- **Assignment Status Badge**: 
  - ⏳ Not Started
  - 📝 Submitted (Pending Review)
  - ✅ Approved
  - 🔄 Needs Revision
- **Milestone Status**: Only shows ✅ when BOTH course and assignment are complete

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

## 🎯 MILESTONE 10 COMPLETION - NORTHSTAR ACHIEVEMENT

### The Journey Completion Moment
When a user completes Milestone 10 (both course AND final assignment), they have achieved their personalized northstar goal. This is a significant moment - they didn't just complete courses, they created real work and achieved a tangible outcome. Whether it took them 3 months or 12 months, they've accomplished something real.

### Celebration View Design

#### 1. **Northstar Achievement Screen**
When Milestone 10's assignment is approved, trigger special celebration:

**Hero Section:**
- 🎯 "NORTHSTAR ACHIEVED!"
- "Congratulations, [Username]!"
- Display their achieved goal: "You've successfully [achievable_goal]"
- Show success metrics with checkmarks

**Journey Transformation:**
- "From Dream to Reality" section
- Original dream → 12-month achievement → What's next
- Visual before/after comparison

**Portfolio Showcase:**
- Display all 10 deliverables they created
- Each subgoal achievement as a portfolio piece
- "View Your Complete Portfolio" button

#### 2. **Achievement Statistics**
Display comprehensive journey metrics:

**Learning Metrics:**
- 10 Courses Completed ✅
- 10 Assignments Approved ✅
- Total hours of content consumed
- Journey duration (first to last milestone)

**Creation Metrics:**
- List of all deliverables created
- For music: tracks produced, EP released, fans gained
- For other paths: relevant tangible outcomes

**Growth Visualization:**
- Skill progression chart
- Timeline of major achievements
- Community impact (if applicable)

#### 3. **Next Steps - Beyond the Northstar**

**"Your Next Horizon" Section:**
Since they've achieved their northstar goal, present paths forward:

**Season 2 Journey:**
- "You achieved: [northstar goal]"
- "Your original dream: [ultimate vision]"
- "Ready for the next level?" → New advanced milestone journey

**Specialization Tracks:**
- Based on their completed work, suggest specialization
- Advanced techniques in their proven strength areas
- Collaboration opportunities with other graduates

**Community Leadership:**
- Become a mentor for new students
- Share your portfolio and inspire others
- Lead workshops on your specialty

#### 4. **Technical Implementation**

**Backend Changes:**
```javascript
// Check dual completion for Milestone 10
async function checkMilestone10Completion(userId) {
  const courseComplete = await getCourseProgress(userId, milestone10.courseId) === 100;
  const assignmentApproved = await getAssignmentStatus(userId, milestone10.assignmentId).approved;
  
  if (courseComplete && assignmentApproved) {
    // Northstar achieved!
    progress.journeyCompleted = true;
    progress.northstarAchieved = true;
    progress.completionDate = new Date().toISOString();
    progress.currentMilestone = "completed";
    
    // Calculate portfolio items from all approved assignments
    progress.portfolio = await compilePortfolio(userId);
  }
}

// New endpoint for northstar achievement data
app.get('/api/milestone-roadmap/:userId/northstar-achievement', async (req, res) => {
  // Return:
  // - Original dream vs achieved goal
  // - All 10 deliverables/portfolio items
  // - Success metrics achievement
  // - Journey statistics
  // - Next steps recommendations
});
```

**Frontend Celebration Trigger:**
```javascript
// Detect northstar achievement
if (progress.northstarAchieved) {
  showNorthstarAchievementView({
    achievedGoal: plan.northstar.achievable_goal,
    originalDream: plan.northstar.original_dream,
    portfolio: progress.portfolio,
    metrics: plan.northstar.success_metrics,
    duration: calculateJourneyDuration(progress)
  });
}
```

#### 5. **Data Schema Updates**

**Enhanced Progress JSON for Completion:**
```json
{
  "userId": "string",
  "currentMilestone": "completed",
  "journeyCompleted": true,
  "northstarAchieved": true,
  "completionDate": "2024-12-15T10:00:00Z",
  "milestonesCompleted": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "portfolio": [
    {
      "milestone": 1,
      "deliverable": "16-bar darkwave progression",
      "submittedDate": "2024-02-15T10:00:00Z",
      "approvedDate": "2024-02-16T10:00:00Z"
    },
    // ... all 10 deliverables
  ],
  "journeyStats": {
    "startDate": "2024-01-15T10:00:00Z",
    "endDate": "2024-12-15T10:00:00Z",
    "totalDuration": "7 months",  // varies per student (3-12 months)
    "coursesCompleted": 10,
    "assignmentsApproved": 10,
    "northstarMetricsAchieved": ["5 tracks produced", "523 fans gained", "4 performances"]
  }
}
```

### Implementation Priority

**Phase 1 - Dual-Track Foundation:** 
- Update plan schema with northstar and subgoals
- Implement assignment tracking via LearnWorlds API
- Update milestone completion logic to require both tracks
- Modify UI to show dual progress indicators

**Phase 2 - Northstar Achievement:**
- Build celebration screen for northstar achievement
- Portfolio compilation from all deliverables
- Success metrics validation
- Next steps recommendation engine

**Phase 3 - Enhanced Support:**
- Mentor session package integration
- Assignment feedback display
- Peer showcase features
- Advanced analytics on both tracks

### Success Criteria
- ✅ Students achieve real, tangible outcomes (not just course completion)
- ✅ Clear northstar goal that's achievable in 3-12 months based on their time commitment
- ✅ Progressive subgoals that build toward the main goal
- ✅ Dual-track progress clearly visible at all times
- ✅ Meaningful celebration when northstar is achieved
- ✅ Portfolio of 10 deliverables as proof of achievement
- ✅ Clear next steps after northstar completion
- ✅ Support system for students who struggle with assignments

---

## Example: Darkwave Producer Journey

### Northstar Goal
- **Original Dream**: "Become a world-famous darkwave artist"
- **Achievable Goal (3-12 months)**: "Release a 5-track darkwave EP and build 500 engaged fans"

### Progressive Subgoals
1. **Music Theory**: Create darkwave chord progression
2. **Synthesis**: Design 5 signature synth patches
3. **Drum Programming**: Produce 3 drum patterns
4. **Songwriting**: Complete first full track
5. **Vocal Production**: Record/process vocals for 2 tracks
6. **Mixing**: Mix 3 tracks to professional standard
7. **Mastering**: Master 3 tracks for streaming
8. **Branding**: Create complete artist brand package
9. **Marketing**: Launch campaign, gain 100 subscribers
10. **Release**: Release EP with 500+ launch week streams

### Completion Moment
When the student's EP is released and achieves 500+ streams (Milestone 10 assignment approved), they have achieved their northstar goal. The celebration screen acknowledges not just course completion, but the real achievement of releasing music and building an audience.

---

This README reflects the enhanced dual-track milestone system with personalized northstar goals and real-world deliverables.