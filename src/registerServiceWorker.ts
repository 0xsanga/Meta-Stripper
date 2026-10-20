export const registerAppShell = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.register('/sw.js')
}
