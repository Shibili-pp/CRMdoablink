import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Bell, Building2, CalendarClock, Clock3, FileBarChart, Inbox, Kanban, KeyRound, LayoutDashboard,
  Link2, ListChecks, LogOut, Menu, Phone, PhoneCall, ScrollText, Search, Settings, Shuffle, Target, Trophy, UserRound, Users, X,
} from 'lucide-react';
import api, { getToken } from '../api/client';
import { API_URL } from '../api/config';
import HourlyLock from '../components/HourlyLock';
import OverduePopup from '../components/OverduePopup';
import { NAV } from '../constants/nav';
import { useApp } from '../context/AppContext';

const ICONS = {
  dashboard: LayoutDashboard,
  leads: Users,
  pipeline: Kanban,
  bucket: Inbox,
  assign: Shuffle,
  assignAllow: Shuffle,
  followups: CalendarClock,
  calls: Phone,
  callsToday: PhoneCall,
  hourly: Clock3,
  staff: UserRound,
  users: KeyRound,
  targets: Target,
  leaderboard: Trophy,
  reports: FileBarChart,
  alerts: Bell,
  audit: ScrollText,
  branches: Building2,
  preset: ListChecks,
  connection: Link2,
  settings: Settings,
};

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
}

function openNotification(row, navigate) {
  if (row?.module === 'leads' && row?.recordId) {
    navigate(`/leads/${row.recordId}`);
    return;
  }
  navigate('/notifications');
}

export default function AppLayout() {
  const { user, logout, can } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [recent, setRecent] = useState([]);

  const loadInbox = () => {
    api.get('/api/v1/notifications?limit=8').then((response) => {
      setUnread(response.data.meta?.unread || 0);
      setRecent(response.data.data || []);
    }).catch(() => {});
  };

  useEffect(() => {
    loadInbox();
    const socket = io(API_URL || undefined, { auth: { token: getToken() } });
    socket.on('notification', (payload) => {
      setUnread((count) => count + 1);
      setRecent((rows) => [{
        _id: payload.id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        module: payload.module,
        recordId: payload.recordId,
        createdAt: payload.createdAt,
        readAt: null,
      }, ...rows].slice(0, 8));
    });
    return () => socket.disconnect();
  }, [user]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2 || !can('leads.view')) {
      setHits([]);
      return undefined;
    }
    const handle = setTimeout(() => {
      api.get(`/api/v1/leads?q=${encodeURIComponent(query)}&limit=5`).then((response) => setHits(response.data.data || [])).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const items = NAV.filter((item) => {
    if (item.roles) return item.roles.includes(user?.role);
    if (item.any) return can(...item.any);
    return can(item.permission);
  });
  const rnpPending = recent.filter((row) => !row.readAt && String(row.type || '').startsWith('rnp')).length;

  const markAndOpen = async (row) => {
    setBellOpen(false);
    if (row?._id && !row.readAt) {
      try {
        await api.post(`/api/v1/notifications/${row._id}/read`);
        setUnread((count) => Math.max(0, count - 1));
        setRecent((rows) => rows.map((item) => (item._id === row._id ? { ...item, readAt: new Date().toISOString() } : item)));
      } catch (_) { /* ignore */ }
    }
    openNotification(row, navigate);
  };

  return (
    <div className="app-shell">
      {open && <button className="backdrop" type="button" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><LayoutDashboard size={18} /></span>
          <div>
            <strong>DoablinkOrbit</strong>
            <span>DOABLINK PRIVATE LIMITED</span>
          </div>
          {open && <button className="icon-btn menu-close" type="button" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button>}
        </div>
        <nav className="nav">
          {items.map((item) => {
            const Icon = ICONS[item.icon] || LayoutDashboard;
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setOpen(false)}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" type="button" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((value) => !value)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="search-wrap">
            <Search size={16} className="search-icon" aria-hidden="true" />
            <input aria-label="Search lead name, phone or ID" value={query} placeholder="Search leads" onChange={(event) => setQuery(event.target.value)} />
            {!!hits.length && (
              <div className="search-hits card">
                {hits.map((hit) => (
                  <button key={hit._id} className="search-hit" type="button" onClick={() => { setQuery(''); setHits([]); setOpen(false); navigate(`/leads/${hit._id}`); }}>
                    <strong>{hit.leadCode}</strong>
                    <span>{hit.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="who">
            <div className="bell-wrap">
              <button
                className="icon-btn bell"
                type="button"
                aria-label={unread ? `${unread} unread alerts` : 'Alerts'}
                aria-expanded={bellOpen}
                onClick={() => { setBellOpen((value) => !value); if (!bellOpen) loadInbox(); }}
              >
                <Bell size={18} />
                {unread > 0 && <span className="count">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {bellOpen && (
                <div className="bell-panel card" role="menu">
                  <div className="bell-head">
                    <strong>Notifications</strong>
                    {rnpPending > 0 && <span className="badge priority-high">RNP pending ({rnpPending})</span>}
                  </div>
                  {!recent.length && <p className="muted" style={{ margin: '8px 0' }}>No notifications yet</p>}
                  {recent.map((row) => (
                    <button
                      key={row._id}
                      type="button"
                      className={`bell-item ${row.readAt ? '' : 'unread'} ${String(row.type || '').startsWith('rnp') ? 'rnp' : ''}`}
                      onClick={() => markAndOpen(row)}
                    >
                      <strong>{row.title}</strong>
                      <span>{row.body}</span>
                    </button>
                  ))}
                  <button className="btn ghost" type="button" onClick={() => { setBellOpen(false); navigate('/notifications'); }}>View all</button>
                </div>
              )}
            </div>
            <div className="who-meta">
              <strong>{user.name}</strong>
              <div className="muted">{user.role.replaceAll('_', ' ')}</div>
            </div>
            <div className="avatar" title={`${user.name}, ${user.role.replaceAll('_', ' ')}`}>{initials(user.name)}</div>
            <button className="icon-btn" type="button" aria-label="Log out" onClick={logout}><LogOut size={18} /></button>
          </div>
        </header>
        <div className="content">
          {user.isDemo && <div className="banner">You are signed in with a demo account. Sample records are marked as demo data and are not device-verified call logs. Demo sign-in is disabled in production.</div>}
          <Outlet />
        </div>
        <OverduePopup />
        <HourlyLock />
      </div>
    </div>
  );
}
