
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Course, Stage } from "@/types/database.types";

export const useRoadmap = () => {
  const queryClient = useQueryClient();

  const { data: stages, isLoading: isLoadingStages } = useQuery({
    queryKey: ["stages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stages")
        .select("*")
        .order("order", { ascending: true });

      if (error) throw error;
      return data as Stage[];
    },
  });

  const { data: userCourses, isLoading: isLoadingCourses } = useQuery({
    queryKey: ["user_courses"],
    queryFn: async () => {
      const { data: userCourses, error } = await supabase
        .from("user_courses")
        .select(`
          *,
          courses (*)
        `)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return userCourses;
    },
  });

  const addCourse = useMutation({
    mutationFn: async (course: Course) => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      if (!user) {
        throw new Error("User must be logged in to add courses");
      }

      const { error } = await supabase.from("user_courses").insert({
        course_id: course.id,
        stage_id: course.stage_id,
        user_id: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user_courses"] });
      toast.success("Course added to roadmap");
    },
    onError: (error) => {
      console.error("Error adding course:", error);
      toast.error("Failed to add course");
    },
  });

  const removeCourse = useMutation({
    mutationFn: async (courseId: string) => {
      const { error } = await supabase
        .from("user_courses")
        .delete()
        .eq("course_id", courseId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user_courses"] });
      toast.success("Course removed from roadmap");
    },
    onError: (error) => {
      console.error("Error removing course:", error);
      toast.error("Failed to remove course");
    },
  });

  return {
    stages,
    userCourses,
    isLoading: isLoadingStages || isLoadingCourses,
    addCourse,
    removeCourse,
  };
};
