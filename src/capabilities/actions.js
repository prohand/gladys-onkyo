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

function zoneLine(zone, language) {
  const fr = language === 'fr';
  if (!zone.online) {
    return `${zone.name} (${zone.host}) — ${fr ? 'injoignable' : 'unreachable'}`;
  }
  const parts = [
    zone.power === 1 ? (fr ? 'allumé' : 'on') : fr ? 'en veille' : 'standby',
    zone.sourceName,
    zone.volume === null ? null : `${zone.volume} %`,
    zone.mute === 1 ? (fr ? 'muet' : 'muted') : null,
  ].filter(Boolean);
  return `${zone.name} (${zone.host}) — ${fr ? 'connecté' : 'connected'} : ${parts.join(', ')}`;
}

function scaleHint(receiver, config, language) {
  const volmax = receiver.description?.zones?.find((zone) => zone.key === 'main')?.volmax;
  if (!volmax) {
    return null;
  }
  return language === 'fr'
    ? `   L'ampli annonce un volume maximal de ${volmax} (échelle réglée : ${config.volume_resolution} pas).`
    : `   The receiver reports a maximum volume of ${volmax} (scale set: ${config.volume_resolution} steps).`;
}

export async function testConnection(hub) {
  const silent = (await hub.probeConfiguredHosts())
    .map((info, index) => (info ? null : parseHosts(hub.config.hosts)[index]))
    .filter(Boolean);
  await hub.publishDevices();

  if (hub.list.length === 0 && silent.length === 0) {
    return {
      en: 'No receiver yet. Open the Discovery tab to scan the network, or type the address of the receiver in the configuration.',
      fr: "Aucun ampli pour l'instant. Ouvrez l'onglet Découverte pour scanner le réseau, ou saisissez l'adresse de l'ampli dans la configuration.",
    };
  }

  const message = {};
  for (const language of ['en', 'fr']) {
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
      lines.push(
        language === 'fr'
          ? `${host}:${port} — aucune réponse (adresse, veille réseau, pare-feu ?)`
          : `${host}:${port} — no answer (address, network standby, firewall?)`,
      );
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
    };
  }
  const { receiver } = hub.target(fields.device);
  const answer = await receiver.raw(command);
  if (answer === null) {
    return {
      en: `${command} sent. The receiver answered nothing (normal for some commands).`,
      fr: `${command} envoyée. L'ampli n'a rien répondu (normal pour certaines commandes).`,
    };
  }
  // An NRI answer is a whole XML document: the start is enough here.
  const shown = answer.length > 500 ? `${answer.slice(0, 500)}…` : answer;
  return {
    en: `${command} sent. Answer: ${shown}`,
    fr: `${command} envoyée. Réponse : ${shown}`,
  };
}
