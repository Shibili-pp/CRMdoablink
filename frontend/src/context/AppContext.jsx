import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api, { getToken, messageFrom, setToken } from '../api/client';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = (message, type = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, type }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200);
  };

  const confirm = (options) => new Promise((resolve) => {
    setConfirmState({ ...options, resolve });
  });

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    api.get('/api/v1/auth/me').then((response) => setUser(response.data.data)).catch(() => setToken('')).finally(() => setReady(true));
  }, []);

  const login = async (username, password) => {
    const response = await api.post('/api/v1/auth/login', { username, password });
    setToken(response.data.data.accessToken);
    setUser(response.data.data.user);
    return response.data.data.user;
  };

  const logout = async () => {
    try { await api.post('/api/v1/auth/logout', {}); } catch (error) { /* session may already be gone */ }
    setToken('');
    setUser(null);
  };

  const value = useMemo(() => ({
    user,
    ready,
    login,
    logout,
    toast,
    confirm,
    can: (...permissions) => {
      if (!user) return false;
      if (user.role === 'OWNER') return true;
      return permissions.some((permission) => user.permissions?.includes(permission));
    },
  }), [user, ready]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-stack">
        {toasts.map((item) => <div key={item.id} className={`toast ${item.type === 'error' ? 'error' : ''}`}>{item.message}</div>)}
      </div>
      {confirmState && (
        <div className="modal-back">
          <div className="modal">
            <h2>{confirmState.title || 'Please confirm'}</h2>
            <p className="muted" style={{ margin: '8px 0 16px' }}>{confirmState.message}</p>
            <div className="actions">
              <button className="btn secondary" type="button" onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>Cancel</button>
              <button className={`btn ${confirmState.danger ? 'danger' : ''}`} type="button" onClick={() => { confirmState.resolve(true); setConfirmState(null); }}>{confirmState.confirmLabel || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

export { messageFrom };
