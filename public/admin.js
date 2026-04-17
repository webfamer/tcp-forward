const form = document.getElementById("config-form");
const textarea = document.getElementById("targets");
const saveButton = document.getElementById("save-button");
const statusNode = document.getElementById("status");
const listenAddressNode = document.getElementById("listen-address");
const adminAddressNode = document.getElementById("admin-address");
const targetCountNode = document.getElementById("target-count");
const configPathNode = document.getElementById("config-path");
let isDirty = false;

function setDisabled(disabled) {
  saveButton.disabled = disabled;
}

function setStatus(kind, message) {
  statusNode.className = kind ? `status ${kind}` : "status";
  statusNode.textContent = message || "";
}

function readTargets() {
  return textarea.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderMeta(meta) {
  listenAddressNode.textContent = `${meta.listenHost}:${meta.listenPort}`;
  adminAddressNode.textContent = meta.adminAddress;
  targetCountNode.textContent = String(meta.targetCount);
  configPathNode.textContent = meta.configPath;
}

function renderConfig(config) {
  if (isDirty) {
    return;
  }

  textarea.value = config.targets.join("\n");
  targetCountNode.textContent = String(config.targets.length);
}

async function loadPage() {
  setDisabled(true);
  setStatus("", "");

  const [metaResponse, configResponse] = await Promise.all([
    fetch("/api/meta", { cache: "no-store" }),
    fetch("/api/config", { cache: "no-store" }),
  ]);
  const metaPayload = await metaResponse.json();
  const configPayload = await configResponse.json();

  if (!metaResponse.ok) {
    throw new Error(metaPayload.error || "加载运行信息失败");
  }

  if (!configResponse.ok) {
    throw new Error(configPayload.error || "加载配置失败");
  }

  renderMeta(metaPayload.meta);
  renderConfig(configPayload.config);
  setDisabled(false);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setDisabled(true);
  setStatus("", "正在保存...");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: readTargets() }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "保存失败");
    }

    isDirty = false;
    renderConfig(payload.config);
    setStatus("ok", "目标地址已保存。");
  } catch (error) {
    setStatus("error", error.message);
  } finally {
    setDisabled(false);
  }
});

textarea.addEventListener("input", () => {
  isDirty = true;
});

loadPage().catch((error) => {
  setStatus("error", error.message);
  setDisabled(false);
});
