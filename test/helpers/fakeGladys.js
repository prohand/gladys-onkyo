// -----------------------------------------------------------------------------
// In-memory stand-in for the Gladys SDK object, for unit tests: it builds the
// external ids the way the SDK does and records every call the code makes.
// -----------------------------------------------------------------------------

export function createFakeGladys({ devices = [], scanReplies = [] } = {}) {
  const published = [];
  const transports = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const discovered = [];
  const widgetRefreshes = [];
  const scans = [];

  return {
    selector: 'onkyo',
    devices,
    published,
    transports,
    connectionStatuses,
    sceneEvents,
    discovered,
    widgetRefreshes,
    scans,

    externalId(suffix) {
      return `ext:onkyo:${suffix}`;
    },

    externalIds(type, platformId) {
      const device = `ext:onkyo:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishTransports(entries) {
      transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    async publishDiscoveredDevices(list) {
      discovered.push(list);
    },

    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },

    async scanNetwork(type, options) {
      scans.push({ type, options });
      return scanReplies;
    },

    /** States published for one feature, in order. */
    statesOf(featureExternalId) {
      return published
        .filter((entry) => entry.featureExternalId === featureExternalId)
        .map((entry) => entry.state);
    },
  };
}
