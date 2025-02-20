// LearnWorlds Integration Script
(function() {
  const API_URL = 'https://learn-pathway-widget.vercel.app';
  let userCoursesCache = null;

  document.addEventListener('DOMContentLoaded', initializeRoadmapButtons);

  async function initializeRoadmapButtons() {
    const userId = "{{USER.ID}}";
    if (!userId) return;

    try {
      const response = await fetch(`${API_URL}/api/roadmap/${userId}`);
      if (!response.ok) throw new Error('Failed to fetch roadmap');
      const data = await response.json();
      userCoursesCache = new Set(data.courses);
      userCoursesCache.add('getting-started');
      
      addStyles();
      processAllCourseCards();
      observeNewCards();
    } catch (error) {
      console.error('Error:', error);
    }
  }

  function processAllCourseCards() {
    const selectors = ['.course-card', '.lw-course-card', '[data-course-id]', '[href*="courseid="]', '.catalog-item'];
    const courseCards = new Set();
    const progress = {};

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(card => {
        const fullCard = card.closest('.course-card') || card.closest('.lw-course-card') || card;
        if (!fullCard) return;
        
        courseCards.add(fullCard);
        const courseId = getCourseIdFromCard(fullCard);
        if (!courseId) return;

        // Get progress using exact selector chain
        const progressElement = fullCard.querySelector('.learnworlds-overline-text.learnworlds-element.no-margin-bottom');
        if (progressElement) {
          const progressText = progressElement.textContent.trim();
          const progressValue = parseInt(progressText, 10);
          if (!isNaN(progressValue)) {
            progress[courseId] = progressValue;
            console.log(`Found progress for ${courseId}:`, progressValue);
          }
        }
      });
    });

    // Send progress to widget
    const iframe = document.getElementById('pathway-widget');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ 
        type: "USER_DATA",
        data: { username: "{{USER.NAME}}", userId: "{{USER.ID}}", progress }
      }, "https://learn-pathway-widget.vercel.app");
    }

    // Add buttons
    courseCards.forEach(card => addButtonToCourseCard(card));
  }

  function addButtonToCourseCard(courseCard) {
    if (courseCard.querySelector('.roadmap-button-container')) return;

    const courseId = getCourseIdFromCard(courseCard);
    if (!courseId) return;

    courseCard.style.position = 'relative';
    
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'roadmap-button-container';

    const button = document.createElement('button');
    button.className = 'roadmap-button add';
    
    updateButtonState(button, isInRoadmap(courseId));

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
              body: JSON.stringify({ courseId, courseTitle })
            }
          );
          if (!response.ok) throw new Error('Failed to add course');
        }
        
        if (removing) {
          userCoursesCache.delete(courseId);
        } else {
          userCoursesCache.add(courseId);
        }
        
        updateButtonState(button, !removing);
      } catch (error) {
        console.error('Error:', error);
      } finally {
        button.disabled = false;
      }
    });

    buttonContainer.appendChild(button);
    courseCard.appendChild(buttonContainer);
  }

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

  function isInRoadmap(courseId) {
    return userCoursesCache ? userCoursesCache.has(courseId) : false;
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
        processAllCourseCards();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();
