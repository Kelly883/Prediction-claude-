'use client';

import Link from 'next/link';
import Logo from '@/components/Logo';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <Link href="/" className="footer__logo" aria-label="PredictPro home" style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Logo size="lg" showTagline />
          </Link>
          <p className="footer__description">
            Football predictions backed by research, data and analysis - not luck.
          </p>
          <nav className="footer__social" aria-label="Social media links">
            <a
              href="https://x.com"
              target="_blank"
              rel="noopener noreferrer"
              className="footer__social-link"
              aria-label="Follow us on X"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
              </svg>
            </a>
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="footer__social-link"
              aria-label="Follow us on Facebook"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
              </svg>
            </a>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              className="footer__social-link"
              aria-label="Follow us on Instagram"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.51" />
              </svg>
            </a>
            <a
              href="https://youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              className="footer__social-link"
              aria-label="Follow us on YouTube"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
                <path d="M10 15l5-3-5-3z" />
              </svg>
            </a>
          </nav>
        </div>

        <nav className="footer__nav-section" aria-labelledby="footer-platform">
          <h4 id="footer-platform" className="footer__heading">Platform</h4>
          <ul className="footer__link-list">
            <li><Link href="/football-predictions" className="footer__link">Predictions</Link></li>
            <li><Link href="/archive" className="footer__link">Results Archive</Link></li>
            <li><Link href="/pricing" className="footer__link">Pricing</Link></li>
            <li><Link href="/how-it-works" className="footer__link">How It Works</Link></li>
            <li><Link href="/faq" className="footer__link">FAQ</Link></li>
          </ul>
        </nav>

        <nav className="footer__nav-section" aria-labelledby="footer-company">
          <h4 id="footer-company" className="footer__heading">Company</h4>
          <ul className="footer__link-list">
            <li><Link href="/terms" className="footer__link">Terms of Service</Link></li>
            <li><Link href="/privacy" className="footer__link">Privacy Policy</Link></li>
          </ul>
        </nav>
      </div>

      <div className="footer__bottom">
        <p className="footer__disclaimer">
          Predictions are provided for informational purposes only. We do not guarantee winnings. Please gamble responsibly and only if you are of legal gambling age in your country.
        </p>
        <div className="footer__copyright-row">
          <span className="footer__copyright">&copy; 2026 PredictPro. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}