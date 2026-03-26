'use client';

// ============================================================
// Header Component
// ============================================================
// Sticky navigation bar with logo and route links.
// Uses Space Mono for the retro-modern branding feel.
// Includes a responsive mobile hamburger menu.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Header.module.css';

const NAV_LINKS = [
  { href: '/',             label: 'Home' },
  { href: '/feasibility',  label: 'Feasibility' },
  { href: '/dashboard',    label: 'Dashboard' },
];

export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        {/* ── Logo ── */}
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>🛡️</span>
          <span className={styles.logoText}>
            DRI<span>&</span>CA
          </span>
        </Link>

        {/* ── Mobile menu toggle ── */}
        <button
          className={styles.menuButton}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle navigation menu"
          id="nav-toggle"
        >
          {menuOpen ? '✕' : '☰'}
        </button>

        {/* ── Navigation ── */}
        <nav
          className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`}
          id="main-nav"
        >
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={
                pathname === href ? styles.navLinkActive : styles.navLink
              }
              onClick={() => setMenuOpen(false)}
              id={`nav-${label.toLowerCase()}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
