# Onkyo

Cette intégration pilote depuis Gladys les **amplis audio-vidéo Onkyo** reliés au
réseau, ainsi que les **Integra** et les **Pioneer** récents qui parlent le même
protocole (eISCP).

Tout reste **en local** : Gladys parle directement à l'ampli sur votre réseau
(port 60128). Pas de compte, pas de cloud, pas d'Internet.

## Avant de commencer

1. L'ampli doit être **branché au réseau** (câble ou Wi-Fi).
2. Activez la **veille réseau** sur l'ampli : `Setup` → `Hardware` →
   `Power Management` → `Network Standby` → `On` (le nom varie un peu selon les
   modèles). Sans elle, l'ampli coupe le réseau en veille : Gladys le perd et ne
   peut plus l'allumer.
3. Donnez-lui une **IP fixe** dans votre box (conseillé, pas obligatoire : si
   l'IP change, l'intégration le retrouve par son adresse MAC).

Une seule connexion à la fois sur certains anciens modèles : si l'appli Onkyo
Remote est ouverte, l'ampli peut refuser Gladys. Fermez l'appli et attendez une
minute.

## Ajouter un ampli

1. Installez l'intégration depuis le store Gladys.
2. Ouvrez l'onglet **Découverte** : Gladys cherche les amplis sur le réseau.
3. Ajoutez celui (ou ceux) qui apparaissent. Une fiche est créée par **zone**.

L'ampli n'apparaît pas ? Il est peut-être sur un autre sous-réseau ou un VLAN :
saisissez son IP dans **Adresses des amplis** (plusieurs séparées par des
virgules), enregistrez, puis relancez la découverte.

## Réglages

| Réglage                          | Rôle                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adresses des amplis**          | Uniquement pour un ampli que la découverte ne trouve pas. Ex. `192.168.1.40, 192.168.1.41`                                                                                    |
| **Zones**                        | `Automatique` : les zones que l'ampli déclare (zone principale seule sur les anciens modèles). Ou forcez 1, 2 ou 3 zones.                                                     |
| **Échelle de volume de l'ampli** | La valeur de volume la plus haute affichée par l'ampli : 80 sur la plupart, 200 sur les récents qui avancent par 0,5. « Tester la connexion » indique ce que l'ampli déclare. |
| **Volume maximal (%)**           | Gladys n'envoie **jamais** un volume au-dessus, quoi que demande un curseur, un bouton ou une scène. Par défaut 80 %.                                                         |
| **Journaux détaillés**           | Journalise chaque message échangé avec l'ampli. À activer pour comprendre un problème, puis à couper.                                                                         |

Le volume est exprimé en **pourcentage de l'échelle** : à 50 % sur une échelle
de 80, l'ampli affiche 40.

## Ce que vous obtenez

### Zone principale

- **Marche / veille**
- **Volume** (curseur, en %), **Volume +**, **Volume −**, **Muet** (inverse)
- **Entrée** : liste des entrées, avec les noms que vous leur avez donnés sur
  l'ampli (modèles récents) ou les noms standard (BD/DVD, CD, NET…)
- **Mode d'écoute** : Stéréo, Direct, Dolby, DTS…
- **Préréglage radio** (1 à 40)
- **Lecture, Pause, Stop, Précédent, Suivant** : pour le lecteur réseau, USB ou
  Bluetooth de l'ampli
- **En cours de lecture** : artiste et titre

### Zone 2 et zone 3

Marche, volume, muet, volume +/−, entrée. L'entrée « Source de la zone
principale » fait suivre la zone principale.

Tout changement fait **à la télécommande, sur la façade ou dans une autre appli**
remonte tout de suite dans Gladys : l'ampli prévient, Gladys n'a pas besoin de
l'interroger en boucle.

## Scènes (Gladys 5.1+)

### Déclencheurs

- **L'entrée d'un ampli a changé** : quelqu'un a choisi une autre entrée
  (télécommande, façade, appli). Filtrez par zone et par entrée. Variables :
  `source` (code) et `source_name` (nom). Les ordres de Gladys ne le
  déclenchent jamais (pas de boucle).
- **Un nouveau morceau est joué** : le lecteur réseau ou USB passe à un autre
  morceau. Variables : `title`, `artist`, `album`.
- **Un ampli est connecté ou déconnecté** : la liaison tombe (débranché, veille
  réseau coupée) ou revient. Un redémarrage de Gladys ne le déclenche pas.

### Actions

- **Jouer une entrée sur un ampli** : allume la zone si besoin, attend qu'elle
  soit prête, choisit l'entrée puis règle le volume (facultatif). Idéal pour
  « la radio dans la cuisine à 7 h ».
- **Couper le son d'un ampli** : couper, remettre ou inverser.
- **Changer le mode d'écoute** de la zone principale.
- **Envoyer une commande ISCP** : n'importe quelle commande du protocole Onkyo,
  pour ce que les autres actions ne couvrent pas. La réponse de l'ampli est
  disponible pour les actions suivantes.

Exemple : « quand la télé s'allume → Jouer l'entrée TV à 35 % ».

## Widget du tableau de bord (Gladys 5.1+)

Le widget **Ampli Onkyo** affiche une zone (choisie dans ses réglages, ou la
zone principale du premier ampli) :

- volume et entrée ;
- état : alimentation, morceau en cours, son, mode d'écoute, liaison ;
- boutons : marche/veille, volume −, volume +, muet quand la zone est allumée ;
  marche et **Lire une source** quand elle est en veille.

**Lire une source** ouvre un petit formulaire : choisissez une entrée de la
zone (celle en cours est pré-remplie) et, si vous voulez, un volume en %,
plafonné par le réglage **Volume maximal**. Gladys allume la zone, l'attend,
puis choisit l'entrée et règle le volume, exactement comme l'action de scène. Ce
formulaire demande Gladys 5.2 ou plus récent, désormais requis par
l'intégration.

## Boutons de la configuration

- **Tester la connexion** : une ligne par zone (connecté ou non, état, entrée,
  volume) et les adresses saisies qui n'ont pas répondu.
- **Envoyer une commande ISCP** : essayez une commande avant de la mettre dans
  une scène. Exemples : `PWR01` (allumer), `MVL20` (volume), `SLI23` (entrée
  CD), `LMDQSTN` (quel mode d'écoute ?).

## En cas de souci

| Problème                                      | Piste                                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| L'ampli n'apparaît pas dans Découverte        | Veille réseau activée ? Même réseau que Gladys ? Sinon saisissez son IP dans « Adresses des amplis ».                                    |
| « Injoignable » dès que l'ampli est en veille | Activez la veille réseau (voir plus haut).                                                                                               |
| Le volume ne correspond pas à l'affichage     | Réglez « Échelle de volume de l'ampli » (80 ou 200 le plus souvent).                                                                     |
| Une entrée manque dans la liste               | Les anciens modèles n'annoncent pas leurs entrées : la liste standard est utilisée. Utilisez « Envoyer une commande ISCP » avec `SLIxx`. |
| Lecture/Pause sans effet                      | Ces touches pilotent le lecteur réseau/USB/Bluetooth de l'ampli, pas une source HDMI.                                                    |

Pour un rapport de bug, activez **Journaux détaillés**, reproduisez le problème
et joignez les logs **sans** adresses IP ni MAC :
<https://github.com/prohand/gladys-onkyo/issues>
