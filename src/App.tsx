import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import PostPage from './pages/PostPage';
import TagsPage from './pages/TagsPage';
import AboutPage from './pages/AboutPage';
import GalleryPage from './pages/GalleryPage';
import StatsPage from './pages/StatsPage';
import LoginPage from './pages/LoginPage';

/* ═══════════════════════════════════════════════════
   路由守卫：未登录 → 踢到 /login
   ═══════════════════════════════════════════════════ */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady]   = useState(false);
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuth(!!data.session);
      setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session) => setIsAuth(!!session)
    );
    return () => subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />;
}

/* ═══════════════════════════════════════════════════ */
export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="pb-16">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/post/:slug" element={<PostPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/tags/:tag" element={<TagsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/stats"
              element={
                <AuthGuard>
                  <StatsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/gallery"
              element={
                <AuthGuard>
                  <GalleryPage />
                </AuthGuard>
              }
            />
            <Route
              path="/gallery/:album"
              element={
                <AuthGuard>
                  <GalleryPage />
                </AuthGuard>
              }
            />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-200 bg-white">
          <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-gray-400">
            <p>© 2026 博客主题 · Built with React + TypeScript + Vite</p>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
