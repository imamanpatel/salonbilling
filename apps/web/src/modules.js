// Feature modules register themselves by adding src/modules/<name>/index.jsx with a default export:
// {
//   routes: [{ path: 'appointments', element: <Page />, roles?: ['SUPERADMIN', 'ADMIN'], layout?: 'app' | 'bare' | 'public' }],
//     'app' (default) renders inside the sidebar layout, 'bare' is signed-in without the layout (e.g. print views),
//     'public' needs no sign-in (online booking, feedback forms).
//   nav: [{ group: 'Front desk', label: 'Appointments', to: '/appointments', icon: LucideIcon, order: 20, roles?: [...] }],
//   clientSections: [Component],  // rendered in the client profile with props { client }
// }

const found = import.meta.glob('./modules/*/index.jsx', { eager: true });

const modules = Object.keys(found)
  .sort()
  .map((key) => found[key].default)
  .filter(Boolean);

export const moduleRoutes = modules.flatMap((m) => m.routes ?? []);
export const moduleNav = modules.flatMap((m) => m.nav ?? []);
export const clientSections = modules.flatMap((m) => m.clientSections ?? []);
