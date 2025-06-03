import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useUserRole() {
  const { user } = useUser();
  const userDoc = useQuery(api.users.getUserByClerkId, {
    clerkId: user?.id || "",
  });

  return {
    isInterviewer: userDoc?.role === "interviewer",
    isCandidate: userDoc?.role === "candidate",
    isLoading: userDoc === undefined,
  };
}