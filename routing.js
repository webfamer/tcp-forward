const FRAME_TYPES = new Set(["*", "FUSE", "HOST", "ECCN", "IOTD"]);

function normalizeMatcherValue(value, fieldName, { uppercase = false } = {}) {
  const normalized = String(value ?? "*").trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return uppercase ? normalized.toUpperCase() : normalized;
}

function normalizeDestination(destination, fieldName) {
  if (destination === undefined || destination === null || destination === "") {
    return null;
  }

  const normalized = String(destination).trim();
  if (!normalized) {
    throw new Error(`${fieldName} is empty`);
  }

  return normalized;
}

function normalizeRoute(route, index, parseTargetString) {
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    throw new Error(`route ${index + 1} must be an object`);
  }

  const frameType = normalizeMatcherValue(route.frameType, `route ${index + 1} frameType`, {
    uppercase: true,
  });
  if (!FRAME_TYPES.has(frameType)) {
    throw new Error(`route ${index + 1} frameType is not supported`);
  }

  const deviceAddress = normalizeMatcherValue(
    route.deviceAddress,
    `route ${index + 1} deviceAddress`,
  );
  const dataType = normalizeMatcherValue(route.dataType, `route ${index + 1} dataType`, {
    uppercase: true,
  });
  const rawPrimary = normalizeDestination(route.primary, `route ${index + 1} primary`);
  const primary = rawPrimary ? parseTargetString(rawPrimary, 0).target : null;
  const replyPolicy = String(route.replyPolicy || "none").trim().toLowerCase();
  if (replyPolicy !== "none") {
    throw new Error(`route ${index + 1} replyPolicy must be none`);
  }
  const mirrors = Array.isArray(route.mirrors)
    ? route.mirrors
        .map((target, targetIndex) =>
          normalizeDestination(target, `route ${index + 1} mirror ${targetIndex + 1}`),
        )
        .filter(Boolean)
        .map((target, targetIndex) => parseTargetString(target, targetIndex).target)
    : [];

  if (!primary && mirrors.length === 0) {
    throw new Error(`route ${index + 1} requires a primary or mirror target`);
  }

  return {
    frameType,
    deviceAddress,
    dataType,
    primary,
    mirrors: [...new Set(mirrors.filter((target) => target !== primary))],
    replyPolicy,
  };
}

function normalizeDefaultRoute(defaultRoute, parseTargetString) {
  if (defaultRoute === undefined || defaultRoute === null) {
    return null;
  }

  if (typeof defaultRoute !== "object" || Array.isArray(defaultRoute)) {
    throw new Error("defaultRoute must be an object");
  }

  return normalizeRoute(
    {
      frameType: "*",
      deviceAddress: "*",
      dataType: "*",
      ...defaultRoute,
    },
    0,
    parseTargetString,
  );
}

function legacyTargetsToRoutingConfig(targets, parseTargetString) {
  const normalizedTargets = targets
    .map((target) => String(target).trim())
    .filter(Boolean)
    .map((target, index) => parseTargetString(target, index).target);

  if (normalizedTargets.length === 0) {
    throw new Error("at least one target is required");
  }

  return {
    routes: [],
    defaultRoute: {
      frameType: "*",
      deviceAddress: "*",
      dataType: "*",
      primary: normalizedTargets[0],
      mirrors: normalizedTargets.slice(1),
      replyPolicy: "none",
    },
  };
}

function normalizeRoutingConfig(config, parseTargetString) {
  if (Array.isArray(config)) {
    return legacyTargetsToRoutingConfig(config, parseTargetString);
  }

  if (!config || typeof config !== "object") {
    throw new Error("routing config must be an object");
  }

  if (Array.isArray(config.targets) && !Array.isArray(config.routes)) {
    return legacyTargetsToRoutingConfig(config.targets, parseTargetString);
  }

  const routes = Array.isArray(config.routes)
    ? config.routes.map((route, index) => normalizeRoute(route, index, parseTargetString))
    : [];
  const defaultRoute = normalizeDefaultRoute(config.defaultRoute, parseTargetString);

  if (routes.length === 0 && !defaultRoute) {
    throw new Error("at least one route or defaultRoute is required");
  }

  return { routes, defaultRoute };
}

function routeDestinations(route) {
  if (!route) {
    return [];
  }

  return [route.primary, ...route.mirrors].filter(Boolean);
}

function listRoutingTargets(config) {
  return [
    ...new Set([
      ...config.routes.flatMap(routeDestinations),
      ...routeDestinations(config.defaultRoute),
    ]),
  ];
}

function matches(expected, actual) {
  return expected === "*" || expected === actual;
}

function matchRoute(config, classification) {
  const matchesWithScore = config.routes
    .map((route, index) => {
      if (
        !matches(route.frameType, classification.frameType) ||
        !matches(route.deviceAddress, classification.deviceAddress) ||
        !matches(route.dataType, classification.dataType || "*")
      ) {
        return null;
      }

      const score =
        (route.frameType === "*" ? 0 : 4) +
        (route.deviceAddress === "*" ? 0 : 2) +
        (route.dataType === "*" ? 0 : 1);
      return { route, score, index };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return matchesWithScore[0]?.route || config.defaultRoute || null;
}

module.exports = {
  FRAME_TYPES,
  legacyTargetsToRoutingConfig,
  listRoutingTargets,
  matchRoute,
  normalizeRoutingConfig,
  routeDestinations,
};
