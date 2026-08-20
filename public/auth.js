(function guardAdminPage() {
  const isLoggedIn = localStorage.getItem("login") === "true";
  const token = localStorage.getItem("APP_TOKEN");

  if (!isLoggedIn || !token) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login.html?next=${encodeURIComponent(next)}`);
  }
})();
