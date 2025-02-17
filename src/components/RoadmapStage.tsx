
import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { CourseCard } from "./CourseCard";

interface Course {
  id: string;
  title: string;
  description: string;
  progress: number;
  image: string;
}

interface RoadmapStageProps {
  title: string;
  description: string;
  courses: Course[];
  onRemoveCourse: (courseId: string) => void;
}

export const RoadmapStage: React.FC<RoadmapStageProps> = ({
  title,
  description,
  courses,
  onRemoveCourse,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="relative mb-8 animate-fade-in">
      <div className="absolute left-8 h-full w-0.5 bg-[#BBBDC5]/10" />
      
      <div className="flex items-start">
        <div className="relative z-10 mr-4 h-16 w-16 flex-shrink-0 rounded-full bg-[#111111] p-2 shadow-lg">
          <div className="h-full w-full rounded-full border-2 border-[#BBBDC5]/20 bg-[#0A0A0A]" />
        </div>
        
        <div className="flex-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-between rounded-lg bg-[#111111]/50 p-4 backdrop-blur-sm transition-all hover:bg-[#111111]/70"
          >
            <div>
              <h3 className="text-lg font-semibold text-[#F6F8FF]">{title}</h3>
              <p className="text-sm text-[#BBBDC5]">{description}</p>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-[#BBBDC5]" />
            ) : (
              <ChevronDown className="h-5 w-5 text-[#BBBDC5]" />
            )}
          </button>

          <div
            className={cn(
              "mt-4 space-y-4 overflow-hidden transition-all duration-300",
              isExpanded ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
            )}
          >
            {courses.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onRemove={onRemoveCourse}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
