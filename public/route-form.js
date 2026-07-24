(function exposeRouteForm(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.RouteForm = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createRouteForm() {
  const DEVICE_TYPES = {
    all: { frameType: "*", dataType: "*" },
    host: { frameType: "HOST", dataType: "01" },
    sensor: { frameType: "HOST", dataType: "02" },
    "eccn-host": { frameType: "ECCN", dataType: "01" },
    "five-road-temp": { frameType: "ECCN", dataType: "02" },
    fuse: { frameType: "FUSE", dataType: "*" },
    iotd: { frameType: "IOTD", dataType: "*" },
  };

  function deviceTypeForRoute(route) {
    if (route.frameType === "FUSE") {
      return "fuse";
    }
    if (route.frameType === "IOTD") {
      return "iotd";
    }

    return (
      Object.entries(DEVICE_TYPES).find(
        ([, match]) => match.frameType === route.frameType && match.dataType === route.dataType,
      )?.[0] || "all"
    );
  }

  function groupRoutes(routes) {
    const groups = new Map();

    routes.forEach((route) => {
      const deviceType = deviceTypeForRoute(route);
      const key = JSON.stringify([
        deviceType,
        route.primary,
        route.mirrors || [],
        route.replyPolicy || "none",
      ]);
      const existing = groups.get(key);

      if (existing) {
        if (!existing.deviceAddresses.includes("*")) {
          if (route.deviceAddress === "*") {
            existing.deviceAddresses = ["*"];
          } else if (!existing.deviceAddresses.includes(route.deviceAddress)) {
            existing.deviceAddresses.push(route.deviceAddress);
          }
        }
        return;
      }

      groups.set(key, {
        deviceType,
        deviceAddresses: [route.deviceAddress || "*"],
        primary: route.primary || "",
        mirrors: route.mirrors || [],
      });
    });

    return Array.from(groups.values());
  }

  function expandRule(rule) {
    const match = DEVICE_TYPES[rule.deviceType];
    if (!match) {
      throw new Error("设备类型无效");
    }

    return [...new Set(rule.deviceAddresses)].map((deviceAddress) => ({
      ...match,
      deviceAddress,
      primary: rule.primary,
      mirrors: rule.mirrors,
      replyPolicy: "none",
    }));
  }

  return {
    DEVICE_TYPES,
    deviceTypeForRoute,
    expandRule,
    groupRoutes,
  };
});
