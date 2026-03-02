/**
 * Lightweight profiler for delta application hot paths.
 * Adds performance marks visible in Chrome DevTools Performance tab.
 */
export const deltaProfiler = {
  mark: (name: string) => {
    performance.mark(name);
  },
  measure: (name: string, start: string, end?: string) => {
    performance.measure(name, start, end);
  },
};
