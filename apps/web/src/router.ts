import { createRouter, createWebHistory } from 'vue-router';
import LoginPage from './pages/LoginPage.vue';
import CameraPage from './pages/CameraPage.vue';
import RecordsPage from './pages/RecordsPage.vue';
import RecordDetailPage from './pages/RecordDetailPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import ManagerPage from './pages/ManagerPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/', name: 'camera', component: CameraPage },
    { path: '/records', name: 'records', component: RecordsPage },
    { path: '/records/:id', name: 'record', component: RecordDetailPage },
    { path: '/settings', name: 'settings', component: SettingsPage },
    { path: '/manager', name: 'manager', component: ManagerPage },
  ],
});

router.beforeEach(async (to) => {
  if (to.name === 'login') return true;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) {
      return true;
    }
  } catch {}
  return { name: 'login', query: { next: to.fullPath } };
});
