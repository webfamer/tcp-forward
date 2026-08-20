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
    const routeGroups = new Map();

    routes.forEach((route) => {
      const deviceType = deviceTypeForRoute(route);
      const key = JSON.stringify([
        route.name || `__legacy__:${deviceType}`,
        route.primary,
        route.mirrors || [],
        route.replyPolicy || "none",
      ]);
      let group = routeGroups.get(key);

      if (!group) {
        group = {
          name: route.name || "",
          primary: route.primary || "",
          mirrors: route.mirrors || [],
          typeAddresses: new Map(),
        };
        routeGroups.set(key, group);
      }

      const addresses = group.typeAddresses.get(deviceType) || [];
      const address = route.deviceAddress || "*";
      if (address === "*") {
        group.typeAddresses.set(deviceType, ["*"]);
      } else if (!addresses.includes("*") && !addresses.includes(address)) {
        addresses.push(address);
        group.typeAddresses.set(deviceType, addresses);
      }
    });

    const rules = [];
    routeGroups.forEach((group) => {
      const addressGroups = new Map();

      group.typeAddresses.forEach((addresses, deviceType) => {
        const signature = JSON.stringify([...addresses].sort());
        const existing = addressGroups.get(signature);
        if (existing) {
          existing.deviceTypes.push(deviceType);
        } else {
          addressGroups.set(signature, {
            deviceTypes: [deviceType],
            deviceAddresses: addresses,
          });
        }
      });

      addressGroups.forEach(({ deviceTypes, deviceAddresses }) => {
        rules.push({
          name: group.name || `规则 ${rules.length + 1}`,
          deviceTypes,
          deviceAddresses,
          primary: group.primary,
          mirrors: group.mirrors,
        });
      });
    });

    return rules;
  }

  function expandRule(rule) {
    const requestedTypes = rule.deviceTypes || [rule.deviceType];
    const deviceTypes = requestedTypes.includes("all") ? ["all"] : [...new Set(requestedTypes)];
    if (deviceTypes.length === 0 || deviceTypes.some((deviceType) => !DEVICE_TYPES[deviceType])) {
      throw new Error("设备类型无效");
    }

    return deviceTypes.flatMap((deviceType) => {
      const match = DEVICE_TYPES[deviceType];
      return [...new Set(rule.deviceAddresses)].map((deviceAddress) => ({
        ...(rule.name ? { name: rule.name } : {}),
        ...match,
        deviceAddress,
        primary: rule.primary,
        mirrors: rule.mirrors,
        replyPolicy: "none",
      }));
    });
  }

  return {
    DEVICE_TYPES,
    deviceTypeForRoute,
    expandRule,
    groupRoutes,
  };
});
