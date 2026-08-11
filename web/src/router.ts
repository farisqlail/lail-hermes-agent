import { useState, useEffect } from 'react';

export interface RouteState {
  path: string;
  taskId?: string;
  sessionId?: string;
}

export function getHashRoute(): RouteState {
  if (typeof window === 'undefined') {
    return { path: '/' };
  }
  const hash = window.location.hash || '#/';
  
  // Legacy settings redirect
  if (hash === '#settings') {
    window.location.hash = '#/config/general';
    return { path: '/config/general' };
  }

  // Match #/task/<id>
  const taskMatch = hash.match(/^#\/task\/([^/]+)$/);
  if (taskMatch) {
    return { path: '/task', taskId: taskMatch[1] };
  }

  // Match #/session/<id>
  const sessionMatch = hash.match(/^#\/session\/([^/]+)$/);
  if (sessionMatch) {
    return { path: '/', sessionId: sessionMatch[1] };
  }

  // Clean trailing and leading slashes for routing matches
  const path = hash.substring(1) || '/';
  return { path };
}

export function useRoute() {
  const [route, setRoute] = useState<RouteState>(getHashRoute());

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getHashRoute());
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (hash: string) => {
    window.location.hash = hash;
  };

  return { ...route, navigate };
}
