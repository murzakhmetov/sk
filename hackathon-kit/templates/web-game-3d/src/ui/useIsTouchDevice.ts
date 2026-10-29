import { useState } from 'react';

/** True on touch-first devices; `?touch` in the URL forces the touch UI on desktop. */
export function useIsTouchDevice(): boolean {
  const [isTouch] = useState(
    () => window.matchMedia('(pointer: coarse)').matches || new URLSearchParams(window.location.search).has('touch'),
  );
  return isTouch;
}
