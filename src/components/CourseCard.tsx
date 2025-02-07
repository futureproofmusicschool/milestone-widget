
import React from "react";
import { X } from "lucide-react";

interface Course {
  id: string;
  title: string;
  description: string;
  progress: number;
  image: string;
}

interface CourseCardProps {
  course: Course;
  onRemove: (courseId: string) => void;
}

export const CourseCard: React.FC<CourseCardProps> = ({ course, onRemove }) => {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50 p-4 backdrop-blur-sm transition-all hover:bg-gray-900/70">
      <div className="flex items-start gap-4">
        <img
          src={course.image}
          alt={course.title}
          className="h-16 w-16 rounded-md object-cover"
        />
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-medium text-white">{course.title}</h4>
              <p className="mt-1 text-sm text-gray-400">{course.description}</p>
            </div>
            <button
              onClick={() => onRemove(course.id)}
              className="rounded-full p-1 opacity-0 transition-opacity hover:bg-gray-800 group-hover:opacity-100"
            >
              <X className="h-4 w-4 text-gray-400" />
            </button>
          </div>
          <div className="mt-4">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{
                  width: `${course.progress}%`,
                }}
              />
            </div>
            <p className="mt-2 text-right text-xs text-gray-400">
              {course.progress}% Complete
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
