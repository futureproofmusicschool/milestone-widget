
// LearnWorlds Integration Script
(function() {
  const SUPABASE_URL = "https://duhedfsjirpkzckqmgzf.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1aGVkZnNqaXJwa3pja3FtZ3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg5NjQ4NDYsImV4cCI6MjA1NDU0MDg0Nn0.gvrxZc1O67LecA666BdrsgeYQGVvDmPbTYyAkmqiNRM";

  // Initialize Supabase Client
  const initSupabase = async () => {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  };

  // Add Roadmap Button to a single course card
  const addButtonToCourseCard = async (courseCard, supabase, user) => {
    // Find the course link (LearnWorlds uses a stretched link pattern)
    const courseLink = courseCard.querySelector('.lw-course-card--stretched-link');
    if (!courseLink) {
      console.log('No course link found in card');
      return;
    }

    // Extract course ID from the URL (format is /course?courseid=course-name)
    const courseUrl = courseLink.getAttribute('href');
    const courseIdMatch = courseUrl.match(/courseid=([^&]+)/);
    if (!courseIdMatch) {
      console.log('Could not extract course ID from URL:', courseUrl);
      return;
    }
    const courseId = courseIdMatch[1];
    console.log('Found course ID:', courseId);

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'margin: 10px 0; text-align: left; position: relative; z-index: 100;';
    
    // Create button
    const button = document.createElement('button');
    button.style.cssText = `
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      color: white;
      background-color: #3b82f6;
      font-size: 14px;
    `;

    if (!user) {
      button.textContent = 'Login to Add to Roadmap';
      button.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = '/login';
      };
    } else {
      // Check if course is already in user's roadmap
      const { data: existingCourse, error: checkError } = await supabase
        .from('user_courses')
        .select('*')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .single();
      
      button.textContent = existingCourse ? 'Remove from Roadmap' : 'Add to Roadmap';
      button.style.backgroundColor = existingCourse ? '#ef4444' : '#3b82f6';
      
      button.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (existingCourse) {
          // Remove from roadmap
          const { error: removeError } = await supabase
            .from('user_courses')
            .delete()
            .eq('course_id', courseId)
            .eq('user_id', user.id);
            
          if (removeError) {
            console.error('Error removing course:', removeError);
            return;
          }
          
          button.textContent = 'Add to Roadmap';
          button.style.backgroundColor = '#3b82f6';
        } else {
          // Add to roadmap
          const { error: addError } = await supabase
            .from('user_courses')
            .insert({
              course_id: courseId,
              user_id: user.id
            });
            
          if (addError) {
            console.error('Error adding course:', addError);
            return;
          }
          
          button.textContent = 'Remove from Roadmap';
          button.style.backgroundColor = '#ef4444';
        }
      };
    }
    
    buttonContainer.appendChild(button);
    
    // Add button to the course card (under the course title)
    const titleElement = courseCard.querySelector('.learnworlds-heading3') || courseCard;
    titleElement.parentNode.insertBefore(buttonContainer, titleElement.nextSibling);
  };

  // Add Roadmap Buttons to all course cards
  const addRoadmapButtons = async () => {
    const supabase = await initSupabase();
    
    // Check if user is logged in first
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log('Auth state:', user ? 'logged in' : 'not logged in');
    
    // Wait for LearnWorlds to load the cards
    const waitForCards = async (retries = 0, maxRetries = 10) => {
      if (retries >= maxRetries) {
        console.log('Max retries reached waiting for course cards');
        return;
      }
      
      const courseCards = document.querySelectorAll('.lw-course-card, [data-href*="/course?courseid="]');
      if (courseCards.length === 0) {
        console.log('No cards found, retrying in 500ms...');
        await new Promise(resolve => setTimeout(resolve, 500));
        return waitForCards(retries + 1);
      }

      console.log(`Found ${courseCards.length} course cards`);
      courseCards.forEach(card => addButtonToCourseCard(card, supabase, user));
    };

    await waitForCards();
  };

  // Initialize when the page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addRoadmapButtons);
  } else {
    addRoadmapButtons();
  }

  // Also listen for URL changes since LearnWorlds is a SPA
  let lastUrl = location.href; 
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(addRoadmapButtons, 1000); // Wait a bit for LearnWorlds to load the data
    }
  }).observe(document, {subtree: true, childList: true});
})();
