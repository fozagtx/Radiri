type MarkProps = { size?: number };

export function IntentsMark({ size = 15 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 7.2 12 3.6l6 3.6v9.6L12 20.4l-6-3.6V7.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.2 9.4v5.2M14.8 9.4v5.2M9.2 12h5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function RheaMark({ size = 15 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.8 20.4 19H3.6L12 3.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 9.6 15.6 16H8.4L12 9.6Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function CloudMark({ size = 15 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.4 17.2a3.9 3.9 0 0 1-.5-7.77 5.1 5.1 0 0 1 9.9-.9 3.5 3.5 0 0 1 1.8 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10.6v7.2M9.4 15.2 12 17.8l2.6-2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RegistryMark({ size = 15 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.2 10.2h15.6M10.2 10.2v9.6" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.6" />
      <circle cx="7.2" cy="7.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function RpcMark({ size = 15 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13.4 3.4 6.2 13.2h4.4l-1 7.4 7.2-9.8h-4.4l1-7.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
