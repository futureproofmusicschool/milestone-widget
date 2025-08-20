# Sample Student Progress Record

This JSON structure tracks a student's actual progress through their 12-month roadmap. It's kept separate from the main roadmap plan to prevent data corruption and allow for easy updates.

```json
{
  "userId": "user_abc123",
  "planId": "plan_darkwave_ep_2024",
  "startDate": "2024-01-15",
  "lastUpdated": "2024-04-15T14:30:00Z",
  
  "monthlyProgress": [
    {
      "month": 1,
      "status": "complete",
      "weeklyPractices": {
        "week1": true,
        "week2": true,
        "week3": true,
        "week4": true
      },
      "milestoneStatus": {
        "studentComplete": true,
        "studentCompleteDate": "2024-02-10T10:00:00Z",
        "mentorVerified": true,
        "mentorVerifiedDate": "2024-02-12T15:30:00Z",
        "mentorId": "mentor_sarah"
      },
      "courseProgress": {
        "courseId": "ableton-live-basics",
        "completionPercentage": 100,
        "lastAccessed": "2024-02-10T09:45:00Z"
      },
      "notes": "Great progress on the demo. Clean arrangement."
    },
    {
      "month": 2,
      "status": "complete",
      "weeklyPractices": {
        "week1": true,
        "week2": true,
        "week3": true,
        "week4": true
      },
      "milestoneStatus": {
        "studentComplete": true,
        "studentCompleteDate": "2024-03-08T11:00:00Z",
        "mentorVerified": true,
        "mentorVerifiedDate": "2024-03-10T14:00:00Z",
        "mentorId": "mentor_sarah"
      },
      "courseProgress": {
        "courseId": "intro-to-synthesis",
        "completionPercentage": 100,
        "lastAccessed": "2024-03-08T10:30:00Z"
      },
      "notes": "Excellent sound design work. Unique patches created."
    },
    {
      "month": 3,
      "status": "complete",
      "weeklyPractices": {
        "week1": true,
        "week2": true,
        "week3": true,
        "week4": true
      },
      "milestoneStatus": {
        "studentComplete": true,
        "studentCompleteDate": "2024-04-05T09:00:00Z",
        "mentorVerified": true,
        "mentorVerifiedDate": "2024-04-07T16:00:00Z",
        "mentorId": "mentor_sarah"
      },
      "courseProgress": {
        "courseId": "creative-strategies-2",
        "completionPercentage": 100,
        "lastAccessed": "2024-04-05T08:30:00Z"
      },
      "notes": "Strong brand identity developed. Ready for next phase."
    },
    {
      "month": 4,
      "status": "in_progress",
      "weeklyPractices": {
        "week1": true,
        "week2": true,
        "week3": false,
        "week4": false
      },
      "milestoneStatus": {
        "studentComplete": false,
        "studentCompleteDate": null,
        "mentorVerified": false,
        "mentorVerifiedDate": null,
        "mentorId": null
      },
      "courseProgress": {
        "courseId": "mixing-fundamentals",
        "completionPercentage": 45,
        "lastAccessed": "2024-04-15T14:00:00Z"
      },
      "notes": null
    },
    {
      "month": 5,
      "status": "not_started",
      "weeklyPractices": {
        "week1": false,
        "week2": false,
        "week3": false,
        "week4": false
      },
      "milestoneStatus": {
        "studentComplete": false,
        "studentCompleteDate": null,
        "mentorVerified": false,
        "mentorVerifiedDate": null,
        "mentorId": null
      },
      "courseProgress": {
        "courseId": "intro-to-vocal-mixing",
        "completionPercentage": 0,
        "lastAccessed": null
      },
      "notes": null
    }
  ],
  
  "overallStats": {
    "monthsCompleted": 3,
    "currentMonth": 4,
    "totalProgress": 27.5,
    "averageMonthlyCompletion": 91.67,
    "currentStreak": 45,
    "longestStreak": 45,
    "lastActiveDate": "2024-04-15T14:30:00Z"
  },
  
  "mentorInteractions": [
    {
      "date": "2024-02-12T15:30:00Z",
      "type": "milestone_review",
      "month": 1,
      "mentorId": "mentor_sarah"
    },
    {
      "date": "2024-03-10T14:00:00Z",
      "type": "milestone_review",
      "month": 2,
      "mentorId": "mentor_sarah"
    },
    {
      "date": "2024-04-07T16:00:00Z",
      "type": "milestone_review",
      "month": 3,
      "mentorId": "mentor_sarah"
    }
  ],
  
  "achievements": [
    {
      "id": "first_month_complete",
      "name": "First Month Complete",
      "earnedDate": "2024-02-12T15:30:00Z",
      "icon": "🎯"
    },
    {
      "id": "quarter_complete",
      "name": "Q1 Champion",
      "earnedDate": "2024-04-07T16:00:00Z",
      "icon": "🏆"
    },
    {
      "id": "perfect_month",
      "name": "Perfect Month",
      "earnedDate": "2024-02-12T15:30:00Z",
      "description": "Completed all practice and milestone in Month 1",
      "icon": "⭐"
    }
  ]
}
```

## Field Descriptions

### Top Level
- `userId`: Unique identifier for the student
- `planId`: Reference to which roadmap plan they're following
- `startDate`: When the student began the program
- `lastUpdated`: Timestamp of last modification

### Monthly Progress
Each month tracks:
- `status`: `not_started` | `in_progress` | `complete`
- `weeklyPractices`: Boolean flags for each week's completion
- `milestoneStatus`: Dual verification system
  - `studentComplete`: Student's self-assessment
  - `studentCompleteDate`: When student marked complete
  - `mentorVerified`: Mentor's verification
  - `mentorVerifiedDate`: When mentor verified
  - `mentorId`: Which mentor verified
- `courseProgress`: Links to LearnWorlds course data
  - `courseId`: Reference to the recommended course
  - `completionPercentage`: 0-100 progress
  - `lastAccessed`: Last time student accessed the course
- `notes`: Optional mentor feedback or comments

### Overall Stats
Calculated metrics for dashboard display:
- `monthsCompleted`: Count of fully completed months
- `currentMonth`: Which month student is actively working on
- `totalProgress`: Overall percentage (0-100)
- `averageMonthlyCompletion`: Average completion rate for finished months
- `currentStreak`: Days of consecutive activity
- `longestStreak`: Best streak achieved
- `lastActiveDate`: Most recent activity

### Mentor Interactions
Log of all mentor touchpoints:
- `date`: When interaction occurred
- `type`: Type of interaction (milestone_review, check_in, etc.)
- `month`: Related month number
- `mentorId`: Which mentor was involved

### Achievements
Gamification elements earned:
- `id`: Unique achievement identifier
- `name`: Display name
- `earnedDate`: When unlocked
- `icon`: Visual representation
- `description`: Optional details

## Update Patterns

### When Student Checks Weekly Practice:
```json
monthlyProgress[currentMonth].weeklyPractices.week1 = true
```

### When Student Marks Milestone Complete:
```json
monthlyProgress[currentMonth].milestoneStatus.studentComplete = true
monthlyProgress[currentMonth].milestoneStatus.studentCompleteDate = "2024-04-15T10:00:00Z"
```

### When Mentor Verifies:
```json
monthlyProgress[currentMonth].milestoneStatus.mentorVerified = true
monthlyProgress[currentMonth].milestoneStatus.mentorVerifiedDate = "2024-04-17T14:00:00Z"
monthlyProgress[currentMonth].milestoneStatus.mentorId = "mentor_sarah"
monthlyProgress[currentMonth].status = "complete"
```

### Course Progress Sync (from LearnWorlds):
```json
monthlyProgress[currentMonth].courseProgress.completionPercentage = 75
monthlyProgress[currentMonth].courseProgress.lastAccessed = "2024-04-15T14:00:00Z"
```

## Progress Calculation Formula

Month Progress = 
- Practice: 40% (10% each week)
- Course Completion: 30%
- Student Milestone Check: 15%
- Mentor Verification: 15%

Total Progress = (Sum of all month progress) / 12
