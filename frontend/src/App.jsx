import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { Empty, Page } from './components/ui';
import AppLayout from './layouts/AppLayout';
import AssignmentsPage from './pages/AssignmentsPage';
import AuditPage from './pages/AuditPage';
import BranchesPage from './pages/BranchesPage';
import BucketPage from './pages/BucketPage';
import CallsPage from './pages/CallsPage';
import DashboardPage from './pages/DashboardPage';
import FollowupsPage from './pages/FollowupsPage';
import HourlyPage from './pages/HourlyPage';
import ImportPage from './pages/ImportPage';
import LeadDetailPage from './pages/LeadDetailPage';
import LeaderboardPage from './pages/LeaderboardPage';
import LeadsPage from './pages/LeadsPage';
import PipelinePage from './pages/PipelinePage';
import LoginPage from './pages/LoginPage';
import NotificationsPage from './pages/NotificationsPage';
import PerformancePage from './pages/PerformancePage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import StaffPage from './pages/StaffPage';
import UsersPage from './pages/UsersPage';

function Guard() {
  const { user, ready } = useApp();
  if (!ready) return <p className="content">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

function Permit({ permission, any, children }) {
  const { can } = useApp();
  const allowed = any ? can(...any) : can(permission);
  if (allowed) return children;
  return (
    <Page title="Not available" subtitle="This module is outside your role.">
      <Empty title="You do not have access" message="Ask an administrator if your work needs this screen." />
    </Page>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Guard />}>
        <Route path="/" element={<Permit permission="dashboard.view"><DashboardPage /></Permit>} />
        <Route path="/leads" element={<Permit permission="leads.view"><LeadsPage /></Permit>} />
        <Route path="/pipeline" element={<Permit permission="leads.view"><PipelinePage /></Permit>} />
        <Route path="/leads/import" element={<Permit permission="leads.import"><ImportPage /></Permit>} />
        <Route path="/leads/:id" element={<Permit permission="leads.view"><LeadDetailPage /></Permit>} />
        <Route path="/lead-bucket" element={<Permit permission="leads.assign"><BucketPage /></Permit>} />
        <Route path="/assignments" element={<Permit permission="leads.assign"><AssignmentsPage /></Permit>} />
        <Route path="/followups" element={<Permit permission="followups.view"><FollowupsPage /></Permit>} />
        <Route path="/calls" element={<Permit permission="calls.view"><CallsPage /></Permit>} />
        <Route path="/hourly-reports" element={<Permit permission="hourly.view"><HourlyPage /></Permit>} />
        <Route path="/staff" element={<Permit permission="staff.view"><StaffPage /></Permit>} />
        <Route path="/users" element={<Permit permission="roles.manage"><UsersPage /></Permit>} />
        <Route path="/targets" element={<Permit any={['targets.view', 'revenue.view']}><PerformancePage /></Permit>} />
        <Route path="/revenue" element={<Permit any={['targets.view', 'revenue.view']}><PerformancePage /></Permit>} />
        <Route path="/leaderboard" element={<Permit permission="leaderboard.view"><LeaderboardPage /></Permit>} />
        <Route path="/reports" element={<Permit permission="reports.view"><ReportsPage /></Permit>} />
        <Route path="/notifications" element={<Permit permission="notifications.view"><NotificationsPage /></Permit>} />
        <Route path="/audit-logs" element={<Permit permission="audit.view"><AuditPage /></Permit>} />
        <Route path="/branches" element={<Permit any={['branches.manage', 'teams.manage']}><BranchesPage /></Permit>} />
        <Route path="/settings" element={<Permit any={['settings.manage', 'pipeline.manage']}><SettingsPage /></Permit>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
