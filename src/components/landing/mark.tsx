export function RadiriMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="lp-mark"
    >
      <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.4 15.4c1.6-4.2 3.1-6.3 5.2-6.3 1.7 0 2.6 1.1 3.8 3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16.9" cy="8.1" r="1.7" fill="currentColor" />
      <circle cx="7.2" cy="16.1" r="1.7" fill="currentColor" />
    </svg>
  );
}
