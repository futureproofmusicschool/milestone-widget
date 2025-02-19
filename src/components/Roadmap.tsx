
import React, { useEffect, useState, useRef } from "react";
import { CourseCard } from "./CourseCard";
import { useRoadmap } from "@/hooks/useRoadmap";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export const Roadmap: React.FC = () => {
  const { userCourses, isLoading, removeCourse } = useRoadmap();
  const [username, setUsername] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  const sendHeight = () => {
    if (containerRef.current) {
      const height = Math.ceil(containerRef.current.getBoundingClientRect().height);
      console.log("Sending height:", height);
      window.parent.postMessage({ type: "RESIZE", height }, "*");
    }
  };

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const { type, data } = event.data;
      
      if (type === "USER_DATA") {
        console.log("Received user data from Learnworlds:", data);
        setUsername(data.username || "");
        
        if (!data.jwt) {
          console.error("No JWT token received from Learnworlds");
          toast.error("Authentication failed: No token received");
          return;
        }

        try {
          // Call our Learnworlds auth endpoint
          const { data: authData, error: authError } = await supabase.functions.invoke('learnworlds-auth', {
            body: { token: data.jwt }
          });

          if (authError) {
            console.error("Error authenticating:", authError);
            toast.error("Failed to authenticate");
            return;
          }

          if (!authData?.token) {
            console.error("No Supabase token received");
            toast.error("Failed to authenticate");
            return;
          }

          // Sign in with the returned Supabase JWT
          const { data: session, error: signInError } = await supabase.auth.signInWithIdToken({
            provider: 'jwt',
            token: authData.token
          });

          if (signInError) {
            console.error("Error signing in:", signInError);
            toast.error("Failed to authenticate");
            return;
          }

          console.log("Successfully signed in with JWT");
          toast.success("Authentication successful");
          
        } catch (error) {
          console.error("Error in authentication flow:", error);
          toast.error("Failed to authenticate");
        }
      }
    };

    // Send height whenever content changes
    const observer = new ResizeObserver(() => {
      setTimeout(sendHeight, 100);
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener("message", handleMessage);
    window.addEventListener("load", sendHeight);
    
    window.parent.postMessage({ type: "READY" }, "*");

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("load", sendHeight);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setTimeout(sendHeight, 100);
    }
  }, [userCourses, isLoading]);

  if (isLoading) {
    return (
      <div className="bg-[#000000] p-8" ref={containerRef}>
        <div className="mx-auto max-w-3xl">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded bg-[#111111]" />
            <div className="h-4 w-96 rounded bg-[#111111]" />
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="h-16 rounded bg-[#111111]" />
                <div className="h-32 rounded bg-[#111111]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const courses = userCourses?.map((uc) => ({
    id: uc.course_id,
    title: uc.courses.title,
    description: uc.courses.description,
    progress: uc.courses.progress,
    image: uc.courses.image,
    categories: uc.courses.categories
  }));

  return (
    <div ref={containerRef} className="bg-[#000000] p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-white mb-8 text-center">
          {username ? `${username.toUpperCase()}'S COURSE JOURNEY` : 'YOUR COURSE JOURNEY'}
        </h1>
        <div className="space-y-4">
          {courses?.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              onRemove={(courseId) => removeCourse.mutate(courseId)}
            />
          ))}
          {courses?.length === 0 && (
            <p className="text-center text-[#BBBDC5]">
              No courses added to your journey yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
