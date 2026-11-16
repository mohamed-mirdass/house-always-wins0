# Royal Spin — casino multijoueur (points virtuels)

Projet de 2ᵉ année génie informatique. Application web temps réel : **roulette** multijoueur, **blackjack**, **machine à sous**, classement et **mode écran géant** pour projeter la partie.

> Aucun argent réel : tout se joue en points virtuels (1 000 points au départ).

## Lancer en local

```bash
npm install
npm start
```

Le terminal affiche trois adresses :

| Page | Adresse | Usage |
|------|---------|-------|
| Croupier | `http://localhost:3000/host` | lancer la roue, mode automatique, statistiques |
| Écran géant | `http://localhost:3000/tv` | à projeter : roue, classement, QR code |
| Joueurs | `http://<IP du PC>:3000` | les téléphones (même WiFi) scannent le QR code |

Si le QR code pointe vers une mauvaise adresse (carte réseau virtuelle), choisissez la bonne dans la liste déroulante de la page croupier.

## Fonctionnalités

- Roulette européenne (0-36) : numéro plein (×36), rouge/noir, pair/impair, manque/passe, douzaines et colonnes
- Roue animée (canvas), sons (WebAudio), confettis, historique, numéros chauds/froids
- Blackjack contre le croupier (blackjack paie 3 pour 2, doubler)
- Machine à sous (jackpot ×250)
- Niveaux, badges et classement en direct
- Mode automatique : compte à rebours, tirage et nouveau tour sans intervention
- Sauvegarde des joueurs dans `data.json`
- Installable sur téléphone (PWA)

## Architecture

```
server.js          Express + Socket.IO. Toute la logique (paris, tirage, gains,
                   blackjack, slots) est côté serveur.
public/
  index.html       page joueur            js/player.js
  tv.html          écran géant            js/tv.js
  host.html        croupier + stats       js/host.js
  js/shared.js     roue canvas, audio, confettis
  css/casino.css   thème
```

- **Temps réel** : événements Socket.IO (`bet`, `spin`, `state`, `me`…). L'état public est diffusé à tous, l'état privé (mises, main de blackjack) uniquement au joueur concerné.
- **Anti-triche** : le client n'envoie que des intentions. Le serveur valide chaque mise (type, montant, solde), tire le numéro avec `crypto.randomInt` et calcule les gains. Les cartes du croupier restent cachées tant que la main n'est pas terminée.
- **Droits du croupier** : seul `localhost` (ou la clé `HOST_KEY` en ligne) peut lancer la roue ou réinitialiser.
- **Persistance** : `data.json`, écrit toutes les 2 s si quelque chose a changé.

## Mettre en ligne (Render, gratuit)

1. Créer un dépôt GitHub avec ce dossier (le fichier `render.yaml` est déjà prêt).
2. Sur render.com : **New → Blueprint**, choisir le dépôt, valider.
3. Dans **Environment**, lire la valeur de `HOST_KEY` (générée automatiquement). C'est le mot de passe de la page `/host`.
4. Ouvrir `https://<votre-app>.onrender.com/host`, saisir la clé, puis `/tv` sur le projecteur. Le QR code pointe automatiquement vers l'adresse publique.

Notes : l'offre gratuite s'endort après 15 min sans visite (premier chargement lent) et le disque est éphémère, donc `data.json` est remis à zéro à chaque redéploiement.

Variables d'environnement : `PORT`, `HOST_KEY`, `PUBLIC_URL`, `DATA_FILE`.

## Mettre en ligne sur Vercel

Le projet inclut `Dockerfile.vercel` pour lancer le serveur Express + Socket.IO comme un conteneur Vercel.

1. Envoyez le dossier `royal-spin` dans un dépôt GitHub, puis importez ce dépôt dans Vercel.
2. Ajoutez l’intégration Upstash Redis depuis le Marketplace Vercel. Elle fournit `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.
3. Dans **Settings → Environment Variables**, ajoutez `HOST_KEY` avec une longue clé privée. Ne la partagez qu’avec le croupier.
4. Redéployez le projet. Le classement, les noms des joueurs, leurs points, l’historique et les statistiques sont sauvegardés dans Redis. En local, le projet continue d’utiliser `data.json`.

Le classement affiche le solde courant de chaque joueur en points et conserve les joueurs même après leur déconnexion. Les fonctions/containers Vercel peuvent être recyclés ou mis à l’échelle : la sauvegarde Redis conserve les scores, mais cette version garde l’état d’une partie active en mémoire. Elle convient à une petite partie sur une instance; un jeu Vercel multi-instance doit aussi partager l’état de jeu en temps réel entre les instances.
