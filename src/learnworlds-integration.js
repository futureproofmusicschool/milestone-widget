
// LearnWorlds Integration Script
(function() {
  const SUPABASE_URL = "https://duhedfsjirpkzckqmgzf.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1aGVkZnNqaXJwa3pja3FtZ3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg5NjQ4NDYsImV4cCI6MjA1NDU0MDg0Nn0.gvrxZc1O67LecA666BdrsgeYQGVvDmPbTYyAkmqiNRM";

  // Initialize Supabase Client
  const initSupabase = async () => {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  };

  // Add Roadmap Button
  const addRoadmapButton = async () => {
    const supabase = await initSupabase();
    
    // Get current course ID from LearnWorlds
    const courseId = window.course.id;
    
    // Check if user is logged in
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('User not authenticated');
      return;
    }

    // Check if course is already in user's roadmap
    const { data: existingCourse, error: checkError } = await supabase
      .from('user_courses')
      .select('*')
      .eq('course_id', courseId)
      .eq('user_id', user.id)
      .single();

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'margin: 20px 0; text-align: center;';
    
    // Create button
    const button = document.createElement('button');
    button.style.cssText = `
      padding: 10px 20px;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      color: white;
      background-color: ${existingCourse ? '#ef4444' : '#3b82f6'};
    `;
    
    button.textContent = existingCourse ? 'Remove from Roadmap' : 'Add to Roadmap';
    
    button.onclick = async () => {
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
    
    buttonContainer.appendChild(button);
    
    // Insert button into the page
    // Note: Adjust this selector based on where you want the button to appear in LearnWorlds
    const targetElement = document.querySelector('.course-content-header');
    if (targetElement) {
      targetElement.appendChild(buttonContainer);
    }
  };

  // Initialize when the page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addRoadmapButton);
  } else {
    addRoadmapButton();
  }
})();
