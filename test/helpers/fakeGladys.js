// -----------------------------------------------------------------------------
// In-memory stand-in for the Gladys SDK object, for unit tests: it builds the
// external ids the way the SDK does and records every call the code makes.
// publishChangedStates / forgetPublishedStates follow the SDK: an entry equal
// (same `state`, same `text`) to the last ACCEPTED value of its feature is
// skipped, a refused batch is forgotten and its error thrown.
// -----------------------------------------------------------------------------

export function createFakeGladys({ devices = [], scanReplies = [] } = {}) {
  const published = [];
  const transports = [];
  const connectionStatuses = [];
  const sceneEvents = [];
  const discovered = [];
  const widgetRefreshes = [];
  const scans = [];
  // Last value accepted per feature, as publishChangedStates remembers it.
  const remembered = new Map();

  const gladys = {
    selector: 'onkyo',
    devices,
    published,
    transports,
    connectionStatuses,
    sceneEvents,
    discovered,
    widgetRefreshes,
    scans,
    // Set to an Error to make the next state publications fail.
    refuseStates: null,

    externalId(suffix) {
      return `ext:onkyo:${suffix}`;
    },

    externalIds(type, platformId) {
      const device = `ext:onkyo:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    async publishChangedStates(states) {
      const changed = states.filter(({ device_feature_external_id: id, state, text }) => {
        const last = remembered.get(id);
        return last === undefined || last.state !== state || last.text !== text;
      });
      changed.forEach(({ device_feature_external_id: id, state, text }) =>
        remembered.set(id, { state, text }),
      );
      if (gladys.refuseStates) {
        changed.forEach(({ device_feature_external_id: id }) => remembered.delete(id));
        throw gladys.refuseStates;
      }
      // Recorded in the publishState shape the assertions read.
      for (const { device_feature_external_id: id, state, text } of changed) {
        published.push({ featureExternalId: id, state: text === undefined ? state : { text } });
      }
      return { success: true, count: changed.length };
    },

    forgetPublishedStates(externalId) {
      if (externalId === undefined) {
        remembered.clear();
        return;
      }
      for (const id of [...remembered.keys()]) {
        if (id === externalId || id.startsWith(`${externalId}:`)) {
          remembered.delete(id);
        }
      }
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
  return gladys;
}
