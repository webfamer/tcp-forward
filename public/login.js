const LOGIN_API = "https://platform.mzpower.com/api/account/login";
const form = document.getElementById("login-form");
const accountInput = document.getElementById("account");
const passwordInput = document.getElementById("password");
const statusNode = document.getElementById("login-status");
const loginButton = document.getElementById("login-button");

function getNextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

if (localStorage.getItem("login") === "true" && localStorage.getItem("APP_TOKEN")) {
  window.location.replace(getNextPath());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  statusNode.className = "login-status";
  statusNode.textContent = "正在验证账号...";

  try {
    const response = await fetch(LOGIN_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: accountInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    const payload = await response.json();

    if (!response.ok || payload.code !== 200 || !payload.data?.token) {
      throw new Error(payload.message || "账号或密码错误");
    }

    localStorage.setItem("login", "true");
    localStorage.setItem("APP_TOKEN", payload.data.token);
    localStorage.setItem("APP_USER", JSON.stringify(payload.data.userInfo || {}));
    localStorage.setItem("APP_PERMISSIONS", JSON.stringify(payload.data.permissions || []));
    window.location.replace(getNextPath());
  } catch (error) {
    statusNode.className = "login-status error";
    statusNode.textContent = error.message || "登录失败，请稍后重试";
    passwordInput.select();
    loginButton.disabled = false;
  }
});
