// LearnWorlds Integration Script
(function() {
  const API_URL = 'https://learn-pathway-widget.vercel.app'; // Your actual Vercel deployment URL

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

    // Add button styles
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

    // Function to get course ID from card
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

    // Function to check if a course is in user's roadmap
    async function isInRoadmap(courseId, userId) {
      try {
        const response = await fetch(`${API_URL}/api/roadmap/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch roadmap');
        const data = await response.json();
        return data.courses.includes(courseId);
      } catch (error) {
        console.error('Error checking roadmap:', error);
        return false;
      }
    }

    // Function to add button to a course card
    async function addButtonToCourseCard(courseCard) {
      console.log('Processing course card:', courseCard);

      if (courseCard.querySelector('.roadmap-button-container')) {
        return;
      }

      courseCard.style.position = 'relative';

      const courseId = getCourseIdFromCard(courseCard);
      if (!courseId) {
        console.log('No course ID found for card');
        return;
      }

      console.log('Found course ID:', courseId);

      // Create button container
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'roadmap-button-container';

      // Create button
      const button = document.createElement('button');
      button.className = 'roadmap-button add';
      
      // Check if course is already in roadmap
      const inRoadmap = await isInRoadmap(courseId, userId);
      updateButtonState(button, inRoadmap);

      // Handle click events
      const handleClick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const isInRoadmap = button.classList.contains('remove');
        button.disabled = true;

        try {
          if (isInRoadmap) {
            // Remove course from roadmap
            const response = await fetch(`${API_URL}/api/roadmap/${userId}/remove`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ courseId })
            });
            
            if (!response.ok) throw new Error('Failed to remove course');
          } else {
            // Add course to roadmap
            const response = await fetch(`${API_URL}/api/roadmap/${userId}/add`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ courseId })
            });
            
            if (!response.ok) throw new Error('Failed to add course');
          }
          
          updateButtonState(button, !isInRoadmap);
        } catch (error) {
          console.error('Error updating roadmap:', error);
        } finally {
          button.disabled = false;
        }
        
        return false;
      };

      // Add event listeners
      ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(eventType => {
        button.addEventListener(eventType, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (eventType === 'click') handleClick(e);
        }, true);
      });

      buttonContainer.appendChild(button);
      courseCard.appendChild(buttonContainer);
      console.log('Button added to course card');
    }

    // Update button state
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

    // Find and process course cards
    function addRoadmapButtons() {
      console.log('Searching for course cards...');
      
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

    // Initial setup with retry
    function initializeWithRetry(retries = 5) {
      if (retries === 0) {
        console.log('Failed to find course cards after all retries');
        return;
      }

      setTimeout(() => {
        addRoadmapButtons();
        if (document.querySelectorAll('.roadmap-button').length === 0) {
          console.log(`No buttons added, retrying... (${retries} attempts left)`);
          initializeWithRetry(retries - 1);
        }
      }, 1000);
    }

    // Start initialization
    initializeWithRetry();

    // Watch for new cards
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
        addRoadmapButtons();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();
