import Link from 'next/link';

export default function Footer() {
  return (
    <footer style={{ borderTop: '1px solid rgba(243,245,236,0.14)', padding: '40px 0', marginTop: 80 }}>
      <div className="container" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--chalk-muted)' }}>© {new Date().getFullYear()} PredictPro</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link href="/terms" style={{ fontSize: 13, color: 'var(--chalk-muted)', textDecoration: 'none' }}>
            Terms
          </Link>
          <Link href="/privacy" style={{ fontSize: 13, color: 'var(--chalk-muted)', textDecoration: 'none' }}>
            Privacy
          </Link>
          <Link href="/faq" style={{ fontSize: 13, color: 'var(--chalk-muted)', textDecoration: 'none' }}>
            FAQ
          </Link>
          <Link href="/dashboard/plans" style={{ fontSize: 13, color: 'var(--chalk-muted)', textDecoration: 'none' }}>
            Plans
          </Link>
        </div>
      </div>
    </footer>
  );
}
