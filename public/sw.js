// Service worker minimal: permet l'installation de l'application (PWA).
// Aucune mise en cache: le jeu a toujours besoin du serveur en direct.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
