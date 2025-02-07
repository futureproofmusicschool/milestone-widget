
import React from "react";
import { RoadmapStage } from "./RoadmapStage";
import { useRoadmap } from "@/hooks/useRoadmap";

export const Roadmap: React.FC = () => {
  const { stages, userCourses, isLoading, removeCourse } = useRoadmap();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 p-8">
        <div className="mx-auto max-w-3xl">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded bg-gray-800" />
            <div className="h-4 w-96 rounded bg-gray-800" />
            <div className="space-y-8">
              {[1, 2].map((i) => (
                <div key={i} className="space-y-4">
                  <div className="h-16 rounded bg-gray-800" />
                  <div className="h-32 rounded bg-gray-800" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-center text-3xl font-bold text-white">
          Your Learning Roadmap
        </h1>
        <p className="mb-12 text-center text-gray-400">
          Track your progress and customize your learning journey
        </p>

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

            return (
              <RoadmapStage
                key={stage.id}
                title={stage.title}
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
