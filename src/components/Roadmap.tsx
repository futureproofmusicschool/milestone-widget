
import React, { useEffect } from "react";
import { RoadmapStage } from "./RoadmapStage";
import { useRoadmap } from "@/hooks/useRoadmap";

export const Roadmap: React.FC = () => {
  const { stages, userCourses, isLoading, removeCourse } = useRoadmap();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // You can add origin verification if needed
      // if (event.origin !== "https://yourlearnworldsdomain.com") return;
      
      const { type, data } = event.data;
      
      if (type === "USER_DATA") {
        console.log("Received user data from Learnworlds:", data);
        // Here you can handle the user data
        // For example, store it in state or pass it to your Supabase client
      }
    };

    window.addEventListener("message", handleMessage);
    
    // Let the parent know we're ready to receive data
    window.parent.postMessage({ type: "READY" }, "*");

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#000000] p-8">
        <div className="mx-auto max-w-3xl">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded bg-[#111111]" />
            <div className="h-4 w-96 rounded bg-[#111111]" />
            <div className="space-y-8">
              {[1, 2].map((i) => (
                <div key={i} className="space-y-4">
                  <div className="h-16 rounded bg-[#111111]" />
                  <div className="h-32 rounded bg-[#111111]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#000000] p-8">
      <div className="mx-auto max-w-3xl">
        <div className="space-y-8">
          {stages?.map((stage) => {
            const stageCourses = userCourses
              ?.filter((uc) => uc.stage_id === stage.id)
              .map((uc) => ({
                id: uc.course_id,
                title: uc.courses.title,
                description: uc.courses.description,
                progress: uc.courses.progress,
                image: uc.courses.image,
              }));

            let displayTitle = stage.title;
            if (stage.title === "Beginner") displayTitle = "Core Skills";
            if (stage.title === "Intermediate") displayTitle = "Creative Pathways";
            if (stage.title === "Advanced") displayTitle = "Industry Pro";

            return (
              <RoadmapStage
                key={stage.id}
                title={displayTitle}
                description={stage.description}
                courses={stageCourses || []}
                onRemoveCourse={(courseId) => removeCourse.mutate(courseId)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
