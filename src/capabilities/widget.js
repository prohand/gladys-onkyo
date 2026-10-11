// -----------------------------------------------------------------------------
// Dashboard widget "Onkyo receiver" (Gladys 5.1+).
//
// One zone per widget (a `"source": "devices"` setting; the first receiver's
// main zone when none is chosen): what it plays, its volume and input, power,
// mute, listening mode and link, and four buttons — power, volume down, volume
// up, mute. The content is declarative: the core renders it.
//
// The receiver pushes its changes, so the widget is nudged when one comes in
// (rate-limited to one nudge per 10 s by the core: the nudges are spaced here,
// the last change of a burst is never lost). The TTL is only a safety net.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { listeningModeLabel } from '../onkyo/codes.js';

const logger = createLogger({ name: 'widget' });

export const RECEIVER_WIDGET = 'receiver';

export const WIDGET_ACTIONS = {
  POWER: 'power',
  VOLUME_DOWN: 'volume_down',
  VOLUME_UP: 'volume_up',
  MUTE: 'mute',
};

export const NUDGE_INTERVAL_MS = 10000;

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @param {object} hub the ReceiverHub
 * @param {{ settings?: { device?: string } }} request
 */
export function buildWidgetContent(hub, { settings = {} } = {}) {
  const zone = hub.findZone(settings.device);
  if (!zone) {
    return {
      ttl_seconds: 60,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'No Onkyo receiver yet. Add one from the Discovery tab of the integration.',
            fr: "Aucun ampli Onkyo pour l'instant. Ajoutez-en un depuis l'onglet Découverte de l'intégration.",
          },
        },
      ],
    };
  }

  const components = [{ type: 'text', variant: 'heading', text: clip(zone.name, 40) }];

  if (zone.online) {
    components.push(
      {
        type: 'value',
        label: { en: 'Volume', fr: 'Volume' },
        icon: zone.mute === 1 ? 'volume-x' : 'volume-2',
        value: zone.volume ?? '–',
        unit: zone.volume === null ? undefined : '%',
        color: zone.mute === 1 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        label: { en: 'Input', fr: 'Entrée' },
        icon: 'log-in',
        value: clip(zone.sourceName ?? '–', 12),
        color: WIDGET_COLORS.INFO,
      },
    );
  }

  const items = [
    {
      label: { en: 'Link', fr: 'Liaison' },
      icon: 'wifi',
      value: zone.online
        ? { en: 'Connected', fr: 'Connecté' }
        : { en: 'Unreachable', fr: 'Injoignable' },
      color: zone.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  ];
  if (zone.online) {
    items.unshift({
      label: { en: 'Power', fr: 'Alimentation' },
      icon: 'power',
      value: zone.power === 1 ? { en: 'On', fr: 'Allumé' } : { en: 'Standby', fr: 'En veille' },
      color: zone.power === 1 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
    items.push({
      label: { en: 'Sound', fr: 'Son' },
      icon: 'volume-1',
      value: zone.mute === 1 ? { en: 'Muted', fr: 'Coupé' } : { en: 'On', fr: 'Actif' },
      color: zone.mute === 1 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
    if (zone.power === 1 && zone.nowPlaying) {
      items.push({
        label: { en: 'Playing', fr: 'En lecture' },
        icon: 'music',
        value: clip(zone.nowPlaying, 40),
        color: WIDGET_COLORS.PRIMARY,
      });
    }
    if (zone.listeningMode) {
      items.push({
        label: { en: 'Listening mode', fr: "Mode d'écoute" },
        icon: 'sliders',
        value: clip(listeningModeLabel(zone.listeningMode), 40),
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  components.push({ type: 'status', items });

  if (zone.online) {
    const device = zone.deviceExternalId;
    components.push({
      type: 'button',
      label: zone.power === 1 ? { en: 'Standby', fr: 'Veille' } : { en: 'Turn on', fr: 'Allumer' },
      icon: 'power',
      style: zone.power === 1 ? 'secondary' : 'primary',
      action: { key: WIDGET_ACTIONS.POWER, params: { device, on: zone.power !== 1 } },
    });
    if (zone.power === 1) {
      components.push(
        {
          type: 'button',
          label: { en: 'Vol −', fr: 'Vol −' },
          icon: 'minus',
          style: 'secondary',
          action: { key: WIDGET_ACTIONS.VOLUME_DOWN, params: { device } },
        },
        {
          type: 'button',
          label: { en: 'Vol +', fr: 'Vol +' },
          icon: 'plus',
          style: 'secondary',
          action: { key: WIDGET_ACTIONS.VOLUME_UP, params: { device } },
        },
        {
          type: 'button',
          label:
            zone.mute === 1 ? { en: 'Unmute', fr: 'Remettre le son' } : { en: 'Mute', fr: 'Muet' },
          icon: zone.mute === 1 ? 'volume-2' : 'volume-x',
          style: 'secondary',
          action: { key: WIDGET_ACTIONS.MUTE, params: { device } },
        },
      );
    }
  }

  return { ttl_seconds: 30, components };
}

/**
 * A tapped button. `params` are the ones the content declared, never user input.
 * @returns {Promise<object>} the toast
 */
export async function handleWidgetAction(hub, { actionKey, params = {} }) {
  logger.info(`Widget action ${actionKey}`);
  const { receiver, zone } = hub.target(params.device);
  switch (actionKey) {
    case WIDGET_ACTIONS.POWER:
      await receiver.setPower(zone, params.on === true);
      return params.on === true
        ? { en: 'Turning on', fr: 'Allumage' }
        : { en: 'Going to standby', fr: 'Mise en veille' };
    case WIDGET_ACTIONS.VOLUME_DOWN:
      await hub.volumeStep(receiver, zone, false);
      return undefined;
    case WIDGET_ACTIONS.VOLUME_UP:
      await hub.volumeStep(receiver, zone, true);
      return undefined;
    case WIDGET_ACTIONS.MUTE:
      await receiver.setMute(zone, 'toggle');
      return undefined;
    default:
      throw new Error(`Unknown widget action: ${actionKey}`);
  }
}

/**
 * The nudge: at most one every 10 s (the core drops the others), and always
 * one after the last change of a burst.
 * @returns {() => void}
 */
export function createWidgetNudger(
  gladys,
  { intervalMs = NUDGE_INTERVAL_MS, now = Date.now } = {},
) {
  let last = -Infinity;
  let timer = null;
  const fire = () => {
    timer = null;
    last = now();
    gladys.requestWidgetRefresh(RECEIVER_WIDGET);
  };
  return () => {
    if (timer) {
      return;
    }
    const wait = last + intervalMs - now();
    if (wait <= 0) {
      fire();
      return;
    }
    timer = setTimeout(fire, wait);
    timer.unref?.();
  };
}
