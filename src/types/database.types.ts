
export interface UserCourse {
  id: string;
  user_id: string;
  course_id: string;
  created_at: string;
  learnworlds_id: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  progress: number;
  image: string;
  categories: string[];
  learnworlds_id: string;
}
