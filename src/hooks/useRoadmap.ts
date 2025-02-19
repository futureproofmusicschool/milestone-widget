
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Course } from "@/types/database.types";

export const useRoadmap = () => {
  const queryClient = useQueryClient();

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
    userCourses,
    isLoading: isLoadingCourses,
    removeCourse,
  };
};
