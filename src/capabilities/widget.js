// -----------------------------------------------------------------------------
// Dashboard widget "Onkyo receiver" (Gladys 5.1+).
//
// One zone per widget (a `"source": "devices"` setting; the first receiver's
// main zone when none is chosen): what it plays, its volume and input, power,
// mute, listening mode and link, and buttons. The core renders four buttons
// at most: a zone switched on gets power, volume down, volume up and mute; a
// zone in standby gets power and "Play a source" — a form (Gladys 5.2+) with
// the zone's inputs and an optional volume, run like the `play_source` scene
// action (wake, wait, input, volume). That is the gesture of a zone in
// standby; once on, the input is one tap away on the device itself and the
// four one-tap controls keep their place. The content is declarative: the
// core renders it.
//
// The receiver pushes its changes, so the widget is nudged when one comes in
// (rate-limited to one nudge per 10 s by the core: the nudges are spaced here,
// the last change of a burst is never lost). The TTL is only a safety net.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { listeningModeLabel } from '../onkyo/codes.js';
import { SCENE_ACTIONS } from './scenes.js';

const logger = createLogger({ name: 'widget' });

export const RECEIVER_WIDGET = 'receiver';

export const WIDGET_ACTIONS = {
  POWER: 'power',
  VOLUME_DOWN: 'volume_down',
  VOLUME_UP: 'volume_up',
  MUTE: 'mute',
  PLAY_SOURCE: 'play_source',
};

// Button actions opening a form (`fields`): Gladys 5.2 is the first core that
// relays their `values`. test/manifest.test.js ties this list to the manifest
// `gladys_version`.
export const FORM_ACTIONS = [WIDGET_ACTIONS.PLAY_SOURCE];

// The core cuts a form option label past 40 characters.
const OPTION_LABEL_MAX = 40;

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
            de: 'Noch kein Onkyo-Receiver. Fügen Sie einen über den Tab „Entdecken“ der Integration hinzu.',
            es: 'Todavía no hay ningún receptor Onkyo. Añada uno desde la pestaña «Descubrir» de la integración.',
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
        label: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
        icon: zone.mute === 1 ? 'volume-x' : 'volume-2',
        value: zone.volume ?? '–',
        unit: zone.volume === null ? undefined : '%',
        color: zone.mute === 1 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        label: { en: 'Input', fr: 'Entrée', de: 'Eingang', es: 'Entrada' },
        icon: 'log-in',
        value: clip(zone.sourceName ?? '–', 12),
        color: WIDGET_COLORS.INFO,
      },
    );
  }

  const items = [
    {
      label: { en: 'Link', fr: 'Liaison', de: 'Verbindung', es: 'Conexión' },
      icon: 'wifi',
      value: zone.online
        ? { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' }
        : { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
      color: zone.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  ];
  if (zone.online) {
    items.unshift({
      label: { en: 'Power', fr: 'Alimentation', de: 'Betrieb', es: 'Alimentación' },
      icon: 'power',
      value:
        zone.power === 1
          ? { en: 'On', fr: 'Allumé', de: 'Ein', es: 'Encendido' }
          : { en: 'Standby', fr: 'En veille', de: 'Standby', es: 'En espera' },
      color: zone.power === 1 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
    items.push({
      label: { en: 'Sound', fr: 'Son', de: 'Ton', es: 'Sonido' },
      icon: 'volume-1',
      value:
        zone.mute === 1
          ? { en: 'Muted', fr: 'Coupé', de: 'Stumm', es: 'Silenciado' }
          : { en: 'On', fr: 'Actif', de: 'Ein', es: 'Activo' },
      color: zone.mute === 1 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
    if (zone.power === 1 && zone.nowPlaying) {
      items.push({
        label: { en: 'Playing', fr: 'En lecture', de: 'Wiedergabe', es: 'Reproduciendo' },
        icon: 'music',
        value: clip(zone.nowPlaying, 40),
        color: WIDGET_COLORS.PRIMARY,
      });
    }
    if (zone.listeningMode) {
      items.push({
        label: {
          en: 'Listening mode',
          fr: "Mode d'écoute",
          de: 'Wiedergabemodus',
          es: 'Modo de audición',
        },
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
      label:
        zone.power === 1
          ? { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' }
          : { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
      icon: 'power',
      style: zone.power === 1 ? 'secondary' : 'primary',
      action: { key: WIDGET_ACTIONS.POWER, params: { device, on: zone.power !== 1 } },
    });
    if (zone.power === 1) {
      components.push(
        {
          type: 'button',
          label: { en: 'Vol −', fr: 'Vol −', de: 'Vol −', es: 'Vol −' },
          icon: 'minus',
          style: 'secondary',
          action: { key: WIDGET_ACTIONS.VOLUME_DOWN, params: { device } },
        },
        {
          type: 'button',
          label: { en: 'Vol +', fr: 'Vol +', de: 'Vol +', es: 'Vol +' },
          icon: 'plus',
          style: 'secondary',
          action: { key: WIDGET_ACTIONS.VOLUME_UP, params: { device } },
        },
        {
          type: 'button',
          label:
            zone.mute === 1
              ? { en: 'Unmute', fr: 'Remettre le son', de: 'Ton an', es: 'Activar sonido' }
              : { en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silenciar' },
          icon: zone.mute === 1 ? 'volume-2' : 'volume-x',
          style: 'secondary',
          action: { key: WIDGET_ACTIONS.MUTE, params: { device } },
        },
      );
    } else if (zone.inputs.length > 0) {
      components.push(playSourceButton(zone, hub.config.max_volume));
    }
  }

  return { ttl_seconds: 30, components };
}

/**
 * "Play a source": the inputs of THIS zone as static options (an action field
 * takes no `source`), pre-filled with the current one; the volume is optional
 * (empty keeps it) and bounded by the maximum volume setting, which
 * hub.setVolume enforces again whatever arrives.
 */
function playSourceButton(zone, maxVolume) {
  const source = {
    key: 'source',
    type: 'select',
    required: true,
    label: { en: 'Input', fr: 'Entrée', de: 'Eingang', es: 'Entrada' },
    options: zone.inputs.map(({ value, label }) => {
      const text = clip(label, OPTION_LABEL_MAX);
      return { value, label: { en: text, fr: text, de: text, es: text } };
    }),
  };
  if (zone.inputs.some((input) => input.value === zone.source)) {
    source.default = zone.source;
  }
  return {
    type: 'button',
    label: {
      en: 'Play a source',
      fr: 'Lire une source',
      de: 'Quelle abspielen',
      es: 'Reproducir una fuente',
    },
    icon: 'play',
    style: 'secondary',
    action: {
      key: WIDGET_ACTIONS.PLAY_SOURCE,
      params: { device: zone.deviceExternalId },
      fields: [
        source,
        {
          key: 'volume',
          type: 'number',
          min: 0,
          max: maxVolume,
          label: { en: 'Volume (%)', fr: 'Volume (%)', de: 'Lautstärke (%)', es: 'Volumen (%)' },
          placeholder: { en: 'Unchanged', fr: 'Inchangé', de: 'Unverändert', es: 'Sin cambios' },
        },
      ],
    },
  };
}

/**
 * The "Play a source" form: the `play_source` scene action itself, so the
 * wake-up, the wait and the volume cap are the same as in a scene.
 * @returns {Promise<object>} the toast
 */
async function playSource(hub, params, values, options) {
  // A core older than 5.2 drops the form and relays the tap without
  // `values`: there is no input to play, and guessing one would be wrong.
  if (typeof values?.source !== 'string' || values.source.length === 0) {
    return {
      en: 'Choose the input in the form of the button (Gladys 5.2 or later).',
      fr: "Choisissez l'entrée dans le formulaire du bouton (Gladys 5.2 ou plus récent).",
      de: 'Wählen Sie den Eingang im Formular der Schaltfläche (Gladys 5.2 oder neuer).',
      es: 'Elija la entrada en el formulario del botón (Gladys 5.2 o posterior).',
    };
  }
  const outputs = await SCENE_ACTIONS.play_source(
    hub,
    { device: params.device, source: values.source, volume: values.volume },
    options,
  );
  // The label of the option picked: the receiver's echo may not be in yet.
  const name =
    hub.findZone(params.device)?.inputs.find((input) => input.value === outputs.source)?.label ??
    outputs.source;
  return outputs.volume === undefined
    ? {
        en: `Playing ${name}`,
        fr: `Lecture : ${name}`,
        de: `Wiedergabe: ${name}`,
        es: `Reproduciendo ${name}`,
      }
    : {
        en: `Playing ${name} at ${outputs.volume} %`,
        fr: `Lecture : ${name} à ${outputs.volume} %`,
        de: `Wiedergabe: ${name} mit ${outputs.volume} %`,
        es: `Reproduciendo ${name} al ${outputs.volume} %`,
      };
}

/**
 * A tapped button. `params` are the ones the content declared, never user
 * input; `values` are what the user typed in a button form, validated by the
 * core against the fields declared in the content.
 * @param {object} [options] passed to the scene action (`settleMs`, tests)
 * @returns {Promise<object>} the toast
 */
export async function handleWidgetAction(hub, { actionKey, params = {}, values }, options) {
  logger.info(`Widget action ${actionKey}`);
  if (actionKey === WIDGET_ACTIONS.PLAY_SOURCE) {
    return playSource(hub, params, values, options);
  }
  const { receiver, zone } = hub.target(params.device);
  switch (actionKey) {
    case WIDGET_ACTIONS.POWER:
      await receiver.setPower(zone, params.on === true);
      return params.on === true
        ? { en: 'Turning on', fr: 'Allumage', de: 'Wird eingeschaltet', es: 'Encendiendo' }
        : {
            en: 'Going to standby',
            fr: 'Mise en veille',
            de: 'Wechsel in Standby',
            es: 'Pasando a espera',
          };
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
