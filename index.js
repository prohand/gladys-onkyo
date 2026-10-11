// -----------------------------------------------------------------------------
// Entry point of the Onkyo integration for Gladys.
//
// SDK wiring only: every handler is registered BEFORE connect(), and hands the
// work to the hub (src/hub.js), which owns the receivers. No protocol logic
// here.
//
// The Gladys supervisor gives the container GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR; the SDK reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { applyLogLevel } from './src/logging.js';
import { ReceiverHub } from './src/hub.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import {
  RECEIVER_WIDGET,
  buildWidgetContent,
  createWidgetNudger,
  handleWidgetAction,
} from './src/capabilities/widget.js';
import { sendCommand, testConnection } from './src/capabilities/actions.js';

const gladys = new GladysIntegration();
const hub = new ReceiverHub(gladys);
hub.onWidgetChange = createWidgetNudger(gladys);

function applyConfig(raw) {
  const config = normalizeConfig(raw);
  applyLogLevel(config);
  hub.setConfig(config);
}

// --- Discovery: the user opened the Discovery tab -----------------------------
gladys.onScanRequest(async () => {
  logger.info('Scan requested: looking for receivers');
  await hub.discover();
});

// --- A controllable feature was used --------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.debug(`onSetValue <- ${feature.external_id} = ${value}`);
  await hub.handleSetValue(feature, value);
});

// --- A device was created from the Discovery tab: start publishing its states -
gladys.onDeviceCreated(async () => {
  await hub.sync();
});

// --- Configuration screen buttons ----------------------------------------------
gladys.onAction('test_connection', () => testConnection(hub));
gladys.onAction('send_command', (fields) => sendCommand(hub, fields));

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(hub, fields));
}

// --- Dashboard widget (Gladys 5.1+) --------------------------------------------
gladys.onWidgetGet(RECEIVER_WIDGET, (request) => buildWidgetContent(hub, request));
gladys.onWidgetAction(RECEIVER_WIDGET, (actionKey, params) =>
  handleWidgetAction(hub, { actionKey, params }),
);

// --- Configuration saved -------------------------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('Configuration updated');
  applyConfig(newConfig);
  await hub.sync();
  hub.onWidgetChange();
});

// --- Connection to Gladys --------------------------------------------------------
// The SDK logs its own connection lifecycle; this only (re)initializes.
gladys.on('connected', async () => {
  try {
    applyConfig(await gladys.getConfig());
    await hub.sync();
    hub.onWidgetChange();
  } catch (err) {
    logger.error('Initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// An unexpected rejection is logged, never fatal: the receivers stay connected.
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', err);
});

// --- Graceful shutdown -----------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}: closing the receiver links`);
  hub.stop();
});

logger.info('Starting the Onkyo integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
