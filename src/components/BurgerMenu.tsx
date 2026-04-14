import { useState, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useLogStore } from '../stores/logStore';
import { useThemeStore } from '../stores/themeStore';
import { useKeyboardShortcutContextOptional } from './KeyboardShortcutContext';
import { useClickOutside } from '../hooks/useClickOutside';
import styles from './BurgerMenu.module.css';

export function BurgerMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { clearData, clearLastRoute } = useLogStore();
  const { theme, setTheme } = useThemeStore();
  const shortcutCtx = useKeyboardShortcutContextOptional();

  useClickOutside(menuRef, () => setIsOpen(false), isOpen);

  const handleNewSession = () => {
    clearData();
    clearLastRoute();
    void navigate('/');
    setIsOpen(false);
  };

  const handleNavigate = (path: string) => {
    // Preserve only time filter params (start/end) when switching views
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const queryString = params.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;
    void navigate(fullPath);
    setIsOpen(false);
  };

  const isActive = (path: string) => location.pathname === path;
  const isArchiveView = location.pathname === '/archive';

  return (
    <div className={styles.burgerMenu} ref={menuRef}>
      <button
        className={styles.burgerButton}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Menu"
        aria-expanded={isOpen}
      >
        ☰
      </button>
      {isOpen && (
        <div className={styles.burgerDropdown}>
          <button className={styles.burgerItem} onClick={handleNewSession}>
            New Session
          </button>
          {!isArchiveView && (
            <>
          <div className={styles.burgerDivider} />
          <div className={styles.burgerSectionTitle}>Views</div>
          <button 
            className={`${styles.burgerItem} ${isActive('/summary') ? styles.active : ''}`}
            onClick={() => handleNavigate('/summary')}
          >
            Summary
          </button>
          <button 
            className={`${styles.burgerItem} ${isActive('/logs') ? styles.active : ''}`}
            onClick={() => handleNavigate('/logs')}
          >
            All Logs
          </button>
          <button 
            className={`${styles.burgerItem} ${isActive('/http_requests') ? styles.active : ''}`}
            onClick={() => handleNavigate('/http_requests')}
          >
            HTTP Requests
          </button>
          <button 
            className={`${styles.burgerItem} ${isActive('/http_requests/sync') ? styles.active : ''}`}
            onClick={() => handleNavigate('/http_requests/sync')}
          >
            Sync Requests
          </button>
          <div className={styles.burgerDivider} />
          <button
            className={styles.burgerItem}
            onClick={() => { shortcutCtx?.toggleHelp(); setIsOpen(false); }}
          >
            Keyboard Shortcuts
          </button>
            </>
          )}
          <div className={styles.burgerDivider} />
          <div className={styles.themeButtons}>
            <button 
              className={`${styles.themeButton} ${theme === 'system' ? styles.active : ''}`}
              onClick={() => setTheme('system')}
              data-tooltip="System"
              aria-label="System theme"
            >
              ◐
            </button>
            <button 
              className={`${styles.themeButton} ${theme === 'light' ? styles.active : ''}`}
              onClick={() => setTheme('light')}
              data-tooltip="Light"
              aria-label="Light theme"
            >
              ☀
            </button>
            <button 
              className={`${styles.themeButton} ${theme === 'dark' ? styles.active : ''}`}
              onClick={() => setTheme('dark')}
              data-tooltip="Dark"
              aria-label="Dark theme"
            >
              ☾
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
