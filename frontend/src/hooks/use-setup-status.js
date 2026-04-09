import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export function useSetupStatus() {
  return useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiFetch("/setup/status"),
    staleTime: Infinity,
    retry: false,
  });
}
