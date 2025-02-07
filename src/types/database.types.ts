
export interface UserCourse {
  id: string;
  user_id: string;
  course_id: string;
  stage_id: string;
  created_at: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  progress: number;
  image: string;
  stage_id: string;
}

export interface Stage {
  id: string;
  title: string;
  description: string;
  order: number;
}
