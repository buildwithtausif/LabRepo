import React, { useEffect, useState } from 'react';

interface Announcement {
  id: number;
  title: string;
  message: string;
  url: string | null;
  urlLabel: string | null;
  type: 'info' | 'success' | 'warning' | 'critical';
}

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    async function fetchAnnouncements() {
      try {
        const res = await fetch('/api/announcements/active');
        if (res.ok) {
          const data = await res.json();
          if (data.announcements) {
            setAnnouncements(data.announcements);
          }
        }
      } catch (err) {
        console.error('Failed to fetch announcements:', err);
      } finally {
        timeoutId = setTimeout(fetchAnnouncements, 60000);
      }
    }

    fetchAnnouncements();

    return () => clearTimeout(timeoutId);
  }, []);

  if (announcements.length === 0) return null;

  return (
    <div style={{ position: 'relative', zIndex: 100, width: '100%', display: 'flex', flexDirection: 'column' }}>
      {announcements.map((a) => {
        let style: React.CSSProperties = {
          background: 'var(--color-primary-soft)',
          borderColor: 'rgba(197, 27, 27, 0.4)',
          color: 'var(--color-ink)'
        };
        let icon = <i className="bi bi-info-circle"></i>;

        if (a.type === 'success') {
          style.background = 'rgba(73,184,122,.14)';
          style.borderColor = 'rgba(73,184,122,.4)';
          icon = <i className="bi bi-check-circle"></i>;
        } else if (a.type === 'warning') {
          style.background = 'rgba(246,182,83,.14)';
          style.borderColor = 'rgba(246,182,83,.4)';
          icon = <i className="bi bi-exclamation-triangle"></i>;
        } else if (a.type === 'critical') {
          style.background = 'rgba(255,102,102,.14)';
          style.borderColor = 'rgba(255,102,102,.4)';
          icon = <i className="bi bi-exclamation-octagon"></i>;
        }

        return (
          <div key={a.id} style={{ ...style, borderBottomWidth: '1px', borderBottomStyle: 'solid', backdropFilter: 'blur(12px)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.2em', lineHeight: 1 }}>{icon}</span>
              <strong style={{ fontWeight: 600 }}>{a.title}</strong>
              <span style={{ opacity: 0.9 }}>{a.message}</span>
              {a.url && (
                <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '4px', textDecoration: 'underline', fontWeight: 600, color: 'inherit' }}>
                  {a.urlLabel || 'Learn more'}
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
