// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
//   - test_connection: one line per receiver — reachable or not, and what it
//     reports — plus the typed addresses that answered nothing;
//   - send_command: any ISCP command to one receiver, and its answer, to try a
//     command before putting it in a scene.
// -----------------------------------------------------------------------------

import { isValidRawCommand } from '../onkyo/codes.js';
import { parseHosts } from '../onkyo/discovery.js';

// The languages of the Gladys interface; the core shows `en` for any other.
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const WORDS = {
  en: {
    unreachable: 'unreachable',
    connected: 'connected',
    on: 'on',
    standby: 'standby',
    muted: 'muted',
  },
  fr: {
    unreachable: 'injoignable',
    connected: 'connecté',
    on: 'allumé',
    standby: 'en veille',
    muted: 'muet',
  },
  de: {
    unreachable: 'nicht erreichbar',
    connected: 'verbunden',
    on: 'ein',
    standby: 'Standby',
    muted: 'stumm',
  },
  es: {
    unreachable: 'inaccesible',
    connected: 'conectado',
    on: 'encendido',
    standby: 'en espera',
    muted: 'silenciado',
  },
};

function zoneLine(zone, language) {
  const words = WORDS[language] ?? WORDS.en;
  if (!zone.online) {
    return `${zone.name} (${zone.host}) — ${words.unreachable}`;
  }
  const parts = [
    zone.power === 1 ? words.on : words.standby,
    zone.sourceName,
    zone.volume === null ? null : `${zone.volume} %`,
    zone.mute === 1 ? words.muted : null,
  ].filter(Boolean);
  return `${zone.name} (${zone.host}) — ${words.connected} : ${parts.join(', ')}`;
}

const SCALE_HINTS = {
  en: (volmax, steps) =>
    `   The receiver reports a maximum volume of ${volmax} (scale set: ${steps} steps).`,
  fr: (volmax, steps) =>
    `   L'ampli annonce un volume maximal de ${volmax} (échelle réglée : ${steps} pas).`,
  de: (volmax, steps) =>
    `   Der Receiver meldet eine maximale Lautstärke von ${volmax} (eingestellte Skala: ${steps} Schritte).`,
  es: (volmax, steps) =>
    `   El receptor indica un volumen máximo de ${volmax} (escala configurada: ${steps} pasos).`,
};

function scaleHint(receiver, config, language) {
  const volmax = receiver.description?.zones?.find((zone) => zone.key === 'main')?.volmax;
  if (!volmax) {
    return null;
  }
  return (SCALE_HINTS[language] ?? SCALE_HINTS.en)(volmax, config.volume_resolution);
}

const NO_ANSWER = {
  en: (host, port) => `${host}:${port} — no answer (address, network standby, firewall?)`,
  fr: (host, port) => `${host}:${port} — aucune réponse (adresse, veille réseau, pare-feu ?)`,
  de: (host, port) => `${host}:${port} — keine Antwort (Adresse, Netzwerk-Standby, Firewall?)`,
  es: (host, port) => `${host}:${port} — sin respuesta (¿dirección, espera de red, cortafuegos?)`,
};

export async function testConnection(hub) {
  const silent = (await hub.probeConfiguredHosts())
    .map((info, index) => (info ? null : parseHosts(hub.config.hosts)[index]))
    .filter(Boolean);
  await hub.publishDevices();

  if (hub.list.length === 0 && silent.length === 0) {
    return {
      en: 'No receiver yet. Open the Discover tab to scan the network, or type the address of the receiver in the configuration.',
      fr: "Aucun ampli pour l'instant. Ouvrez l'onglet Découverte pour scanner le réseau, ou saisissez l'adresse de l'ampli dans la configuration.",
      de: 'Noch kein Receiver. Öffne den Tab „Entdecken“, um das Netzwerk zu durchsuchen, oder gib die Adresse des Receivers in der Konfiguration ein.',
      es: 'Todavía no hay ningún receptor. Abra la pestaña «Descubrir» para buscar en la red, o escriba la dirección del receptor en la configuración.',
    };
  }

  const message = {};
  for (const language of LANGUAGES) {
    const lines = [];
    for (const receiver of hub.list) {
      for (const zone of hub.allZones().filter((z) => z.id === receiver.id)) {
        lines.push(zoneLine(zone, language));
      }
      const hint = scaleHint(receiver, hub.config, language);
      if (hint) {
        lines.push(hint);
      }
    }
    for (const { host, port } of silent) {
      lines.push(NO_ANSWER[language](host, port));
    }
    message[language] = lines.join('\n');
  }
  return message;
}

export async function sendCommand(hub, fields) {
  const typed = String(fields.command ?? '').trim();
  const command = typed.slice(0, 3).toUpperCase() + typed.slice(3);
  if (!isValidRawCommand(command)) {
    return {
      en: `"${typed}" is not an ISCP command. Examples: PWR01 (on), MVL20 (volume), SLI23 (CD input).`,
      fr: `« ${typed} » n'est pas une commande ISCP. Exemples : PWR01 (allumer), MVL20 (volume), SLI23 (entrée CD).`,
      de: `„${typed}“ ist kein ISCP-Befehl. Beispiele: PWR01 (einschalten), MVL20 (Lautstärke), SLI23 (Eingang CD).`,
      es: `«${typed}» no es un comando ISCP. Ejemplos: PWR01 (encender), MVL20 (volumen), SLI23 (entrada CD).`,
    };
  }
  const { receiver } = hub.target(fields.device);
  const answer = await receiver.raw(command);
  if (answer === null) {
    return {
      en: `${command} sent. The receiver answered nothing (normal for some commands).`,
      fr: `${command} envoyée. L'ampli n'a rien répondu (normal pour certaines commandes).`,
      de: `${command} gesendet. Der Receiver hat nicht geantwortet (bei manchen Befehlen normal).`,
      es: `${command} enviado. El receptor no ha respondido (normal con algunos comandos).`,
    };
  }
  // An NRI answer is a whole XML document: the start is enough here.
  const shown = answer.length > 500 ? `${answer.slice(0, 500)}…` : answer;
  return {
    en: `${command} sent. Answer: ${shown}`,
    fr: `${command} envoyée. Réponse : ${shown}`,
    de: `${command} gesendet. Antwort: ${shown}`,
    es: `${command} enviado. Respuesta: ${shown}`,
  };
}
