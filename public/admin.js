const form = document.getElementById("config-form");
const rulesNode = document.getElementById("rules");
const emptyRulesNode = document.getElementById("empty-rules");
const ruleTemplate = document.getElementById("rule-template");
const addRuleButton = document.getElementById("add-rule-button");
const saveButton = document.getElementById("save-button");
const statusNode = document.getElementById("status");
const listenAddressNode = document.getElementById("listen-address");
const adminAddressNode = document.getElementById("admin-address");
const targetCountNode = document.getElementById("target-count");
const configPathNode = document.getElementById("config-path");
const defaultEnabledNode = document.getElementById("default-enabled");
const defaultFieldsNode = document.getElementById("default-fields");
const defaultDisabledNoteNode = document.getElementById("default-disabled-note");
const defaultPrimaryNode = document.getElementById("default-primary");
const defaultMirrorsNode = document.getElementById("default-mirrors");
const { DEVICE_TYPES, expandRule, groupRoutes } = window.RouteForm;
let isDirty = false;

function splitTargets(value) {
  return value
    .split(/[\n,]/)
    .map((target) => target.trim())
    .filter(Boolean);
}

function setStatus(kind, message) {
  statusNode.className = kind ? `status ${kind}` : "status";
  statusNode.textContent = message || "";
}

function markDirty() {
  isDirty = true;
  saveButton.disabled = false;
  setStatus("", "有未保存的修改");
}

function updateEmptyState() {
  const hasRules = rulesNode.children.length > 0;
  emptyRulesNode.hidden = hasRules;
  Array.from(rulesNode.children).forEach((card, index) => {
    card.querySelector(".rule-number").textContent = String(index + 1).padStart(2, "0");
    card.querySelector(".rule-title").textContent = `规则 ${index + 1}`;
  });
}

function updateAddressField(card) {
  const isFixed = card.querySelector(".address-mode").value === "fixed";
  const addressInput = card.querySelector(".device-address");
  addressInput.disabled = !isFixed;
  addressInput.required = isFixed;
  card.querySelector(".address-field").classList.toggle("muted", !isFixed);
}

function validateTarget(target, fieldName) {
  const separatorIndex = target.lastIndexOf(":");
  const port = Number.parseInt(target.slice(separatorIndex + 1), 10);

  if (
    separatorIndex <= 0 ||
    separatorIndex === target.length - 1 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(`${fieldName} 必须是有效的 host:port`);
  }
}

function createRuleCard(rule = {}) {
  const card = ruleTemplate.content.firstElementChild.cloneNode(true);
  const addressMode = card.querySelector(".address-mode");
  const deviceAddress = card.querySelector(".device-address");
  const deviceType = card.querySelector(".device-type");
  const primary = card.querySelector(".primary-target");
  const mirrors = card.querySelector(".mirror-targets");
  const addresses = rule.deviceAddresses || ["*"];

  addressMode.value = addresses.includes("*") ? "*" : "fixed";
  deviceAddress.value = addresses.includes("*") ? "" : addresses.join("\n");
  deviceType.value = rule.deviceType || "all";
  primary.value = rule.primary || "";
  mirrors.value = Array.isArray(rule.mirrors) ? rule.mirrors.join("\n") : "";

  addressMode.addEventListener("change", () => {
    updateAddressField(card);
    markDirty();
  });
  card.querySelector(".remove-rule").addEventListener("click", () => {
    if (!window.confirm("确定删除这条转发规则吗？")) {
      return;
    }
    card.remove();
    updateEmptyState();
    markDirty();
  });
  card.addEventListener("input", (event) => {
    if (event.target !== addressMode) {
      markDirty();
    }
  });
  card.addEventListener("change", (event) => {
    if (event.target !== addressMode) {
      markDirty();
    }
  });

  updateAddressField(card);
  return card;
}

function addRule(route, { dirty = true } = {}) {
  rulesNode.appendChild(createRuleCard(route));
  updateEmptyState();
  if (dirty) {
    markDirty();
  }
}

function updateDefaultState() {
  const enabled = defaultEnabledNode.checked;
  defaultFieldsNode.hidden = !enabled;
  defaultDisabledNoteNode.hidden = enabled;
  defaultPrimaryNode.required = enabled;
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

  rulesNode.replaceChildren();
  groupRoutes(config.routes).forEach((rule) => addRule(rule, { dirty: false }));
  updateEmptyState();

  defaultEnabledNode.checked = Boolean(config.defaultRoute);
  defaultPrimaryNode.value = config.defaultRoute?.primary || "";
  defaultMirrorsNode.value = config.defaultRoute?.mirrors?.join("\n") || "";
  updateDefaultState();
  targetCountNode.textContent = String(config.targets.length);
}

function readRules() {
  return Array.from(rulesNode.children).flatMap((card, index) => {
    const addressMode = card.querySelector(".address-mode").value;
    const deviceAddresses =
      addressMode === "fixed"
        ? [...new Set(splitTargets(card.querySelector(".device-address").value))]
        : ["*"];
    const primary = card.querySelector(".primary-target").value.trim();
    const deviceType = card.querySelector(".device-type").value;
    const mirrors = splitTargets(card.querySelector(".mirror-targets").value);

    if (addressMode === "fixed" && deviceAddresses.length === 0) {
      throw new Error(`规则 ${index + 1}：请至少填写一个设备地址`);
    }
    const invalidAddress = deviceAddresses.find((address) => !/^\d+$/.test(address));
    if (invalidAddress) {
      throw new Error(`规则 ${index + 1}：设备地址 ${invalidAddress} 不是十进制数字`);
    }
    if (!primary) {
      throw new Error(`规则 ${index + 1}：请填写主目标`);
    }
    if (!DEVICE_TYPES[deviceType]) {
      throw new Error(`规则 ${index + 1}：设备类型无效`);
    }
    validateTarget(primary, `规则 ${index + 1} 的主目标`);
    mirrors.forEach((target, targetIndex) =>
      validateTarget(target, `规则 ${index + 1} 的镜像目标 ${targetIndex + 1}`),
    );
    if (mirrors.includes(primary)) {
      throw new Error(`规则 ${index + 1}：镜像目标不能与主目标重复`);
    }

    return expandRule({
      deviceType,
      deviceAddresses,
      primary,
      mirrors,
    });
  });
}

function readConfig() {
  const defaultRoute = defaultEnabledNode.checked
    ? {
        frameType: "*",
        deviceAddress: "*",
        dataType: "*",
        primary: defaultPrimaryNode.value.trim(),
        mirrors: splitTargets(defaultMirrorsNode.value),
        replyPolicy: "none",
      }
    : null;

  if (defaultRoute && !defaultRoute.primary) {
    throw new Error("请填写未匹配报文的主目标");
  }
  if (defaultRoute) {
    validateTarget(defaultRoute.primary, "未匹配报文的主目标");
    defaultRoute.mirrors.forEach((target, index) =>
      validateTarget(target, `未匹配报文的镜像目标 ${index + 1}`),
    );
    if (defaultRoute.mirrors.includes(defaultRoute.primary)) {
      throw new Error("未匹配报文的镜像目标不能与主目标重复");
    }
  }

  const routes = readRules();
  if (routes.length === 0 && !defaultRoute) {
    throw new Error("至少需要一条转发规则，或启用未匹配报文全量转发");
  }

  return { routes, defaultRoute };
}

async function loadPage() {
  saveButton.disabled = true;
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
}

addRuleButton.addEventListener("click", () => {
  addRule({
    deviceType: "all",
    deviceAddresses: ["*"],
    primary: "",
    mirrors: [],
  });
  rulesNode.lastElementChild.querySelector(".primary-target").focus();
});

defaultEnabledNode.addEventListener("change", () => {
  updateDefaultState();
  markDirty();
});
defaultFieldsNode.addEventListener("input", markDirty);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  setStatus("", "正在校验并保存...");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readConfig()),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "保存失败");
    }

    isDirty = false;
    renderConfig(payload.config);
    setStatus("ok", "配置已保存，新连接将使用最新规则");
  } catch (error) {
    setStatus("error", error.message);
    saveButton.disabled = false;
  }
});

loadPage().catch((error) => {
  setStatus("error", error.message);
  saveButton.disabled = false;
});
