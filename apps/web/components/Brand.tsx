// Brand.tsx is the Wardseal wordmark: a scalloped wax seal with a check cut
// into it - an item that has been counted and sealed.
export function Brand({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <path
          fill="var(--accent)"
          d="M32 3l7.5 5.2 9-1.1 3.6 8.3 8.3 3.6-1.1 9L64 32l-5.2 7.5 1.1 9-8.3 3.6-3.6 8.3-9-1.1L32 61l-7.5-5.2-9 1.1-3.6-8.3-8.3-3.6 1.1-9L0 32l5.2-7.5-1.1-9 8.3-3.6 3.6-8.3 9 1.1z"
        />
        <path
          d="M19 33l9 9 17-20"
          fill="none"
          stroke="var(--accent-ink)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="brand-name">
        Wardseal
        {tagline ? <span className="brand-tag">Tamper-evident inventory</span> : null}
      </span>
    </span>
  );
}
