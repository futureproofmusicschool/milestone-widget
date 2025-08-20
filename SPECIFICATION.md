# Futureproof Student Goal Achievement System - Detailed UI/UX Specification

## Executive Summary
A personalized system that transforms student intake data into actionable 12-milestone learning paths with clear goals and progress tracking. The UI presents a self-paced roadmap with milestones, practice, and course recommendations in an engaging, motivating visual format.

## Important Terminology
- We use **"Milestone"** for each major learning goal (12 total)
- Each milestone is self-paced - students progress when ready, not on a calendar
- The 12 milestones represent a suggested one-year journey but can be completed faster or slower
- Originally designed as monthly goals, now flexible timing based on student pace

## Development Stages

### 🎯 STAGE 1: MVP (Basic Functionality)

#### Core Features
1. **Display 12-milestone roadmap from Google Sheets JSON**
2. **Show current milestone details with:**
   - Milestone focus/title
   - Practice (read-only display)
   - Milestone goal description
   - Recommended course with link
3. **Basic progress tracking:**
   - Student can check off "Milestone Complete" 
   - Visual progress indicator (percentage)
   - Current milestone highlighting
4. **Google Sheets integration:**
   - Read roadmap JSON from cell
   - Read/write student progress record
   - Sync with LearnWorlds API for course completion

#### MVP Visual Layout

##### Header (Simplified)
```
Welcome back, [Student Name]!
Your Goal: "Release a 4-track Darkwave EP"
Current Progress: Milestone 4 of 12 | 25% Complete
```

##### Timeline View (Vertical, Simple)
```
Milestone 1: Ableton Workflow ✅
    |
Milestone 2: Sound Design ✅
    |
Milestone 3: Brand Identity ✅
    |
═══ YOU ARE HERE ═══
    ▼
Milestone 4: Mixing Fundamentals [45%]
    |
Milestone 5: Vocal Processing 🔒
    |
[Remaining milestones...]
```

##### Current Module Card
```
┌──────────────────────────────────────────────┐
│ MILESTONE 4: Mixing Fundamentals             │
│ Progress: ████████░░░░░░ 45%                 │
│                                               │
│ This Milestone's Focus:                      │
│ "Master balanced, professional mixes"        │
│                                               │
│ Practice:                                    │
│ • Apply basic EQ and compression             │
│ • Run psychoacoustic exercises               │
│ • Practice frequency balancing               │
│ • Master bus processing basics               │
│                                               │
│ Goal:                                        │
│ "Produce a mixed version of your demo"       │
│                                               │
│ ☐ Mark Milestone Complete                    │
│                                               │
│ [Start Recommended Course →]                 │
│ "Mixing 1: Build strong foundations"         │
└──────────────────────────────────────────────┘
```

#### MVP Data Structure
```javascript
// Google Sheet Cell A1: Roadmap Plan
{
  "userId": "user123",
  "planId": "darkwave_ep_2024", 
  "northstar": "Release EP...",
  "milestones": [
    {
      "number": 1,
      "focus": "Ableton Workflow",
      "goal": "Complete demo",
      "weeklyPractices": [...],
      "courseRec": {
        "title": "Ableton Basics",
        "courseId": "ableton-basics",
        "url": "..."
      }
    }
  ]
}

// Google Sheet Cell B1: Progress Record (Simple)
{
  "userId": "user123",
  "currentMilestone": 4,
  "milestonesCompleted": [1, 2, 3],
  "milestoneProgress": {
    "4": {
      "started": "2024-04-01",
      "courseProgress": 45,
      "markedComplete": false
    }
  }
}
```

---

### 🚀 STAGE 2: Enhanced Interactivity

#### Additional Features
1. **Weekly practice checkboxes** (student can check off)
2. **Course progress auto-sync** from LearnWorlds
3. **Module completion celebration** animations
4. **Quarterly summary views**
5. **Progress persistence** across sessions
6. **Mobile-optimized responsive design**

#### Enhanced Milestone Card
- Interactive weekly practice checkboxes
- Real-time progress calculation
- Course completion percentage from LearnWorlds
- Smooth transitions between milestones

---

### 🏆 STAGE 3: Gamification & Achievements

#### Features to Add
1. **Achievement System**
   - First Milestone Complete
   - Quarter Champion
   - Streak achievements
   - Course completion badges

2. **Visual Enhancements**
   - Animated progress bars
   - Celebration animations
   - Module transition effects
   - Hover states and micro-interactions

3. **Statistics Dashboard**
   - Days active
   - Current streak
   - Milestones per month average
   - Total courses completed

---

### 👥 STAGE 4: Social & Mentor Features

#### Future Additions
1. **Mentor Verification System**
   - Dual checkbox (student + mentor)
   - Mentor authentication
   - Verification notifications

2. **Community Features**
   - Share achievements
   - Discord integration
   - Progress comparison (anonymous)

3. **Advanced Analytics**
   - Predictive completion dates
   - Personalized pacing recommendations
   - Success pattern recognition

---

## Technical Implementation (All Stages)

### Data Storage
- **Google Sheets Structure:**
  - Column A: User ID
  - Column B: Roadmap Plan JSON
  - Column C: Progress Record JSON
  - Column D: Last Updated

### API Endpoints (MVP)
```
GET /roadmap/:userId - Display roadmap widget
GET /api/roadmap/:userId - Get roadmap + progress data
POST /api/progress/:userId/milestone/:milestoneId - Mark milestone complete
GET /api/learnworlds/progress/:userId - Sync course progress
```

### Color Palette (Consistent Across All Stages)
```css
--bg-primary: #000000;
--bg-secondary: #0a0a0a;
--bg-card: rgba(163, 115, 248, 0.1);
--border: rgba(255, 255, 255, 0.2);
--accent-primary: #A373F8;
--text-primary: #FFFFFF;
--text-secondary: #F6F8FF;
```

## Milestone Progression Logic

### Current Milestone Determination
```javascript
// Milestone is "current" if:
// 1. It's the first incomplete milestone
// 2. Student hasn't marked it complete
// 3. Previous milestones are all complete

getCurrentMilestone() {
  const completed = progress.milestonesCompleted || [];
  for (let i = 1; i <= 12; i++) {
    if (!completed.includes(i)) {
      return i;
    }
  }
  return 12; // All complete
}
```

### Progression Rules
1. **Linear progression**: Must complete milestones in order
2. **Self-paced**: No time limits or deadlines
3. **Flexible completion**: Can mark complete anytime
4. **No going back**: Once complete, milestone stays complete
5. **Course optional**: Can complete milestone without finishing course

## MVP Development Checklist

### Backend Tasks
- [ ] Create new Google Sheets with proper structure
- [ ] Update server.js to read roadmap JSON from sheets
- [ ] Add endpoint to update progress record
- [ ] Integrate LearnWorlds API for course progress
- [ ] Handle JSON parsing and error cases

### Frontend Tasks  
- [ ] Create roadmap display route
- [ ] Build vertical timeline component
- [ ] Implement current milestone card
- [ ] Add "Mark Complete" functionality
- [ ] Style with black/purple theme

### Testing Requirements
- [ ] Load roadmap for different users
- [ ] Mark milestone complete and verify save
- [ ] Sync course progress from LearnWorlds
- [ ] Mobile responsive testing
- [ ] Error handling for missing data

## Success Metrics

### MVP Metrics
- Widget loads in < 2 seconds
- Progress saves successfully
- Course links work correctly
- Mobile responsive display

### Long-term Metrics
- Milestone completion rate
- Average time per milestone
- Course engagement rate
- Student retention

---

This specification provides a clear path from MVP to full-featured system, with Stage 1 being immediately buildable using the existing architecture.