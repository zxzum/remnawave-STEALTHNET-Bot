import { useEffect, useState } from "react";

export const isPageVisible = (visibilityState: DocumentVisibilityState) => visibilityState === "visible";

export function usePageVisibility() {
  const [visible, setVisible] = useState(() => isPageVisible(document.visibilityState));

  useEffect(() => {
    const onChange = () => setVisible(isPageVisible(document.visibilityState));
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}
