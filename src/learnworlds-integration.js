// LearnWorlds Integration Script
(function() {
  const API_URL = 'https://learn-pathway-widget.vercel.app';
  let userCoursesCache = null; // Cache for user's courses

  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', initializeRoadmapButtons);

  async function initializeRoadmapButtons() {
    console.log('Initializing roadmap buttons...');
    
    // Get user ID
    const userId = "{{USER.ID}}";
    if (!userId) {
      console.error('No user ID available');
      return;
    }

    // Fetch user's courses and ensure Getting Started is included
    try {
      const response = await fetch(`${API_URL}/api/roadmap/${userId}`);
      if (!response.ok) throw new Error('Failed to fetch roadmap');
      const data = await response.json();
      userCoursesCache = new Set(data.courses);
      
      // Always include Getting Started in the cache
      userCoursesCache.add('getting-started');
      
      console.log('Cached user courses:', userCoursesCache);
    } catch (error) {
      console.error('Error fetching initial courses:', error);
      return;
    }

    // Add styles and start processing course cards
    addStyles();
    processAllCourseCards();
    observeNewCards();
  }

  // Function to check if a course is in user's roadmap (uses cache)
  function isInRoadmap(courseId) {
    return userCoursesCache ? userCoursesCache.has(courseId) : false;
  }

  // Add button styles
  function addStyles() {
    const styles = document.createElement('style');
    styles.textContent = `
      .roadmap-button-container {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        pointer-events: none;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        padding: 10px;
      }
      .roadmap-button {
        padding: 8px 16px;
        border-radius: 4px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
        color: white;
        pointer-events: auto;
        margin-top: 40px;
      }
      .roadmap-button.add {
        background-color: #3b82f6;
      }
      .roadmap-button.add:hover {
        background-color: #2563eb;
      }
      .roadmap-button.remove {
        background-color: #ef4444;
      }
      .roadmap-button.remove:hover {
        background-color: #dc2626;
      }
    `;
    document.head.appendChild(styles);
  }

  // Process all course cards at once
  function processAllCourseCards() {
    const selectors = [
      '.course-card',
      '.lw-course-card',
      '[data-course-id]',
      '[href*="courseid="]',
      '.catalog-item'
    ];

    const courseCards = new Set();
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(card => {
        courseCards.add(card.closest('.course-card') || card.closest('.lw-course-card') || card);
      });
    });

    console.log('Found course cards:', courseCards.size);
    courseCards.forEach(card => {
      if (card) addButtonToCourseCard(card);
    });
  }

  // Add button to a course card
  async function addButtonToCourseCard(courseCard) {
    if (courseCard.querySelector('.roadmap-button-container')) return;

    const courseId = getCourseIdFromCard(courseCard);
    if (!courseId) return;

    courseCard.style.position = 'relative';
    
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'roadmap-button-container';

    const button = document.createElement('button');
    button.className = 'roadmap-button add';
    
    // Use cached data to set initial state
    updateButtonState(button, isInRoadmap(courseId));

    // Handle click events
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const removing = button.classList.contains('remove');
      button.disabled = true;

      try {
        if (removing) {
          const response = await fetch(
            `${API_URL}/api/roadmap/{{USER.ID}}/remove`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ courseId })
            }
          );
          
          if (!response.ok) throw new Error('Failed to remove course');
        } else {
          const courseTitle = courseCard.querySelector('.learnworlds-heading3')?.textContent?.trim()
            || courseCard.querySelector('.lw-course-card--stretched-link')?.textContent?.trim()
            || `Course: ${courseId}`;

          const response = await fetch(
            `${API_URL}/api/roadmap/{{USER.ID}}/add`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                courseId,
                courseTitle
              })
            }
          );
          
          if (!response.ok) throw new Error('Failed to add course');
        }
        
        // Update cache
        if (removing) {
          userCoursesCache.delete(courseId);
        } else {
          userCoursesCache.add(courseId);
        }
        
        updateButtonState(button, !removing);
      } catch (error) {
        console.error('Error updating roadmap:', error);
      } finally {
        button.disabled = false;
      }
    });

    buttonContainer.appendChild(button);
    courseCard.appendChild(buttonContainer);
  }

  // Helper functions remain the same
  function getCourseIdFromCard(courseCard) {
    const possibleElements = [
      courseCard.querySelector('a[href*="courseid="]'),
      courseCard.querySelector('[data-course-id]'),
      courseCard.closest('[data-course-id]'),
      courseCard
    ];

    for (const element of possibleElements) {
      if (!element) continue;
      const dataId = element.getAttribute('data-course-id');
      if (dataId) return dataId;
      const href = element.getAttribute('href');
      if (href) {
        const match = href.match(/courseid=([^&]+)/);
        if (match) return match[1];
      }
    }
    return null;
  }

  function updateButtonState(button, isInRoadmap) {
    if (isInRoadmap) {
      button.textContent = 'Remove from Roadmap';
      button.classList.remove('add');
      button.classList.add('remove');
    } else {
      button.textContent = 'Add to Roadmap';
      button.classList.remove('remove');
      button.classList.add('add');
    }
    button.disabled = false;
  }

  // Observe DOM for new cards
  function observeNewCards() {
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            if (node.classList && (
              node.classList.contains('course-card') ||
              node.classList.contains('lw-course-card') ||
              node.querySelector('.course-card, .lw-course-card')
            )) {
              shouldUpdate = true;
            }
          }
        });
      });

      if (shouldUpdate) {
        console.log('New course cards detected, updating buttons...');
        processAllCourseCards();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Update the message event listener to be more specific
  window.addEventListener('message', function(event) {
    // Only handle messages related to the roadmap widget
    if (!event.data || !event.data.type) return;
    
    // Only process specific roadmap-related message types
    const roadmapMessageTypes = ['RESIZE', 'READY', 'USER_DATA'];
    if (!roadmapMessageTypes.includes(event.data.type)) return;
    
    // Handle roadmap-specific messages
    if (event.data.type === 'RESIZE') {
      const iframe = document.getElementById('pathway-widget');
      if (iframe) {
        iframe.style.height = `${event.data.height}px`;
      }
    }

    if (event.data.type === 'READY') {
      const iframe = document.getElementById('pathway-widget');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ 
          type: "USER_DATA",
          data: { 
            username: "{{USER.NAME}}",
            userId: "{{USER.ID}}"
          }
        }, "https://learn-pathway-widget.vercel.app");
      }
    }
  });

  // Update the progress detection function to use LearnWorlds API
  async function getAllCourseProgress() {
    const progress = {};
    
    // Get all course cards
    const courseCards = document.querySelectorAll('.course-card, .lw-course-card');
    courseCards.forEach(card => {
      const courseId = getCourseIdFromCard(card);
      if (courseId) {
        // Get progress using exact selector for LearnWorlds progress element
        const progressElement = card.querySelector('.lw-course-card-progress');
        const progressText = progressElement?.textContent?.trim() || '0';
        const progressValue = parseInt(progressText.replace(/[^0-9]/g, ''), 10);
        
        progress[courseId] = progressValue;
        console.log(`Found progress for ${courseId}:`, progressValue); // Debug log
      }
    });
    
    return progress;
  }

  // Remove the separate load event listeners and combine them
  window.addEventListener('load', async function() {
    const iframe = document.getElementById('pathway-widget');
    if (iframe) {
      // First get all course progress
      const progress = await getAllCourseProgress();
      const progressParam = encodeURIComponent(JSON.stringify(progress));
      
      // Update iframe src with both user data and progress
      const baseUrl = iframe.src.split('?')[0];
      iframe.src = `${baseUrl}?userId={{USER.ID}}&username={{USER.NAME}}&progress=${progressParam}`;

      // Send user data message after iframe loads with new src
      iframe.onload = function() {
        iframe.contentWindow.postMessage({ 
          type: "USER_DATA",
          data: { 
            username: "{{USER.NAME}}",
            userId: "{{USER.ID}}",
            progress: progress
          }
        }, "https://learn-pathway-widget.vercel.app");
      };
    }
  });
})();
