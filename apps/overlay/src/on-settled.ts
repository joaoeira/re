import { flushSync } from "@gpuix/react";

// GPUIX repaints only for synchronously flushed updates, and an effect that
// re-ran or unmounted meanwhile must not apply a stale result.
export function onSettled<T>(operation: Promise<T>, apply: (value: T) => void): () => void {
  let cancelled = false;
  void operation.then((value) => {
    if (!cancelled) flushSync(() => apply(value));
  });
  return () => {
    cancelled = true;
  };
}
