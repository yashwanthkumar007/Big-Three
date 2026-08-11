import { useState } from "react";

type LoadingStatus = {
  status: string | null;
  progress?: number;
};

export function useLoadingStatus() {
  const [loading, setLoading] = useState<LoadingStatus>({ status: null });

  const setStatus = (status: string | null, progress?: number) => {
    setLoading({ status, progress });
  };

  return {
    status: loading.status,
    progress: loading.progress,
    setStatus,
  };
}