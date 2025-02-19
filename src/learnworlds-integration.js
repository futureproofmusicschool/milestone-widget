
// LearnWorlds Integration Script
(function() {
  const SUPABASE_URL = "https://duhedfsjirpkzckqmgzf.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1aGVkZnNqaXJwa3pja3FtZ3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg5NjQ4NDYsImV4cCI6MjA1NDU0MDg0Nn0.gvrxZc1O67LecA666BdrsgeYQGVvDmPbTYyAkmqiNRM";

  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', async function() {
    // Add Supabase JS library
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = initializeRoadmapButtons;
    document.head.appendChild(script);
  });

  async function initializeRoadmapButtons() {
    console.log('Initializing roadmap buttons...');
    
    // Create Supabase client
    const { createClient } = supabase;
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Get user ID and authenticate first
    const userId = "{{USER.ID}}";
    const username = "{{USER.USERNAME}}";
    if (!userId) {
      console.error('No user ID available');
      return;
    }

    try {
      console.log('Authenticating with Learnworlds user ID:', userId);
      
      // Call the Edge Function to authenticate
      const { data: authData, error: authError } = await supabaseClient.functions.invoke('learnworlds-auth', {
        body: { token: userId }
      });

      if (authError || !authData?.token) {
        console.error('Authentication failed:', authError || 'No token received');
        return;
      }

      // Sign in with the returned JWT
      const { error: signInError } = await supabaseClient.auth.signInWithIdToken({
        provider: 'jwt',
        token: authData.token
      });

      if (signInError) {
        console.error('Error signing in with JWT:', signInError);
        return;
      }

      console.log('Successfully authenticated with Supabase');
    } catch (error) {
      console.error('Error in authentication flow:', error);
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
      updateButtonState(button, false);

      // Check if course is already in roadmap
      try {
        const { data: existingCourse, error } = await supabaseClient
          .from('user_courses')
          .select('id')
          .eq('learnworlds_id', courseId)
          .eq('user_id', userId)
          .maybeSingle();

        if (!error && existingCourse) {
          updateButtonState(button, true);
        }
      } catch (error) {
        console.error('Error checking course status:', error);
      }

      // Handle click events
      const handleClick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const isInRoadmap = button.classList.contains('remove');
        button.disabled = true;

        try {
          if (isInRoadmap) {
            // Remove course from roadmap
            await supabaseClient
              .from('user_courses')
              .delete()
              .eq('learnworlds_id', courseId)
              .eq('user_id', userId);
          } else {
            // Check if course exists
            const { data: courseData, error: courseError } = await supabaseClient
              .from('courses')
              .select('id')
              .eq('learnworlds_id', courseId)
              .maybeSingle();

            if (courseError) {
              console.error('Error fetching course:', courseError);
              return;
            }

            // Get categories
            const categories = Array.from(courseCard.querySelectorAll('.course-category'))
              .map(el => el.textContent?.trim())
              .filter(Boolean);

            if (!courseData) {
              // Create new course
              const courseTitle = courseCard.querySelector('.course-title')?.textContent?.trim() || 'Untitled Course';
              const courseDesc = courseCard.querySelector('.course-description')?.textContent?.trim() || '';
              const courseImg = courseCard.querySelector('img')?.src || '';

              const { data: newCourse, error: insertError } = await supabaseClient
                .from('courses')
                .insert({
                  learnworlds_id: courseId,
                  title: courseTitle,
                  description: courseDesc,
                  image: courseImg,
                  categories: categories
                })
                .select()
                .maybeSingle();

              if (insertError) {
                console.error('Error creating course:', insertError);
                return;
              }

              // Add to user's roadmap
              await supabaseClient
                .from('user_courses')
                .insert({
                  course_id: newCourse.id,
                  user_id: userId,
                  learnworlds_id: courseId
                });
            } else {
              // Add existing course to roadmap
              await supabaseClient
                .from('user_courses')
                .insert({
                  course_id: courseData.id,
                  user_id: userId,
                  learnworlds_id: courseId
                });
            }
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
          e.stopImmediatePropagation();
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
