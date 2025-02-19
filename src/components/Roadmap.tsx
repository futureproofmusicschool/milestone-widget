
import React, { useEffect, useState, useRef } from "react";
import { RoadmapStage } from "./RoadmapStage";
import { useRoadmap } from "@/hooks/useRoadmap";

export const Roadmap: React.FC = () => {
  const { stages, userCourses, isLoading, removeCourse } = useRoadmap();
  const [username, setUsername] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // You can add origin verification if needed
      // if (event.origin !== "https://yourlearnworldsdomain.com") return;
      
      const { type, data } = event.data;
      
      if (type === "USER_DATA") {
        console.log("Received user data from Learnworlds:", data);
        setUsername(data.username || "");
      }
    };

    const sendHeight = () => {
      if (containerRef.current) {
        // Add extra padding to ensure we capture everything
        const height = containerRef.current.scrollHeight + 32;
        console.log("Sending height:", height);
        window.parent.postMessage({ type: "RESIZE", height }, "*");
      }
    };

    // Send height whenever content changes
    const observer = new ResizeObserver(() => {
      sendHeight();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    // Send initial height after a short delay to ensure content is rendered
    setTimeout(sendHeight, 100);

    window.addEventListener("message", handleMessage);
    
    // Let the parent know we're ready to receive data
    window.parent.postMessage({ type: "READY" }, "*");

    // Set up periodic height checks for the first few seconds
    const intervalId = setInterval(sendHeight, 500);
    setTimeout(() => clearInterval(intervalId), 5000);

    return () => {
      window.removeEventListener("message", handleMessage);
      observer.disconnect();
      clearInterval(intervalId);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="bg-[#000000] p-8" ref={containerRef}>
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
    <div ref={containerRef} className="bg-[#000000] p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-white mb-8 text-center">
          ROADMAP FOR {username.toUpperCase()}
        </h1>
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
