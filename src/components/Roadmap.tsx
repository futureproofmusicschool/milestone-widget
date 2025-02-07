
import React from "react";
import { RoadmapStage } from "./RoadmapStage";

const sampleData = {
  stages: [
    {
      id: "stage-1",
      title: "Stage 0: Find Your Passion",
      description: "Discover what drives you and find your direction",
      courses: [
        {
          id: "course-1",
          title: "Discovering Your Path",
          description: "Learn how to identify your strengths and passions",
          progress: 75,
          image: "https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?auto=format&fit=crop&w=300&q=80",
        },
        {
          id: "course-2",
          title: "Goal Setting Workshop",
          description: "Set achievable goals and create action plans",
          progress: 30,
          image: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?auto=format&fit=crop&w=300&q=80",
        },
      ],
    },
    {
      id: "stage-2",
      title: "Stage 1: Test Your Ideas",
      description: "Validate your concepts and refine your approach",
      courses: [
        {
          id: "course-3",
          title: "Idea Validation",
          description: "Learn how to test and validate your ideas",
          progress: 0,
          image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=300&q=80",
        },
        {
          id: "course-4",
          title: "Market Research",
          description: "Understand your target market and competition",
          progress: 15,
          image: "https://images.unsplash.com/photo-1487058792275-0ad4aaf24ca7?auto=format&fit=crop&w=300&q=80",
        },
      ],
    },
  ],
};

export const Roadmap: React.FC = () => {
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
          {sampleData.stages.map((stage) => (
            <RoadmapStage
              key={stage.id}
              title={stage.title}
              description={stage.description}
              courses={stage.courses}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
