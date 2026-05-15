<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**Statut :** La phase 7 (deuxième vague d'exécution des fonctionnalités) est terminée. Pour la version 1.0.0, la couche de transport : **8 commandes CLI sur 8 implémentées** (init / new / send / close / status / thread / sync / relay). La couche de transport est complète ; la version 1.1 intégrera le plan de contrôle.

Outil de synchronisation pour les environnements de développement appairés, utilisant une approche native de Git, des enveloppes typées et des transferts inter-agents.

## Ce qui est disponible aujourd'hui

**Couche de transport complète pour la version 1.0.0 :**

Toutes les 8 commandes CLI de la version 1.0.0, ainsi que les fonctions utilitaires du moteur qui les sous-tendent. La version 1.0.0 inclut le transport Git, tandis que l'intégration du plan de contrôle est reportée à la version 1.1 (chemin B-2 ; voir [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)).

Commandes de création :

- `rig-bridge init` : initialise le clone local, installe le hook de message de commit et crée le fichier `.bridge/config.yaml` avec l'ID canonique de cet environnement.
- `rig-bridge new <thread-id>` : crée le fichier `<thread-id>/REQUEST.md` à partir du modèle d'enveloppe, avec les métadonnées pré-remplies.
- `rig-bridge send <type> --thread <id>` : crée une enveloppe typée, la valide par rapport au schéma, calcule le hachage du corps, dérive la classe de statut à partir du marqueur, puis effectue un `git commit && git push`.
- `rig-bridge close <thread-id> --status <cancelled|completed>` : crée le fichier `RESOLUTION.md`, effectue un commit et un push.

Commandes d'inspection :

- `rig-bridge status` : affiche les threads ouverts avec la dernière activité, la classe de statut, le type et l'état "sale" ; les options `--json` et `--wide` permettent d'afficher les informations de manière plus détaillée.
- `rig-bridge thread <id>` : affiche la transcription complète de l'enveloppe pour un thread (affichage multi-fenêtres, ordre chronologique ascendant, pagination automatique sur le terminal).

Commandes de synchronisation et d'attestation :

- `rig-bridge sync` : effectue un "fast-forward pull" et affiche les divergences (refuse les modifications non "fast-forward" sauf avec l'option `--auto` ; affiche les divergences nommées à la limite de la synchronisation, conformément à la sémantique de Fossil).
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>` : crée une réponse, une décision ou un accusé de réception attesté par un humain (nécessite un suffixe d'ID d'environnement `-relay` et une clé de signature Git configurée ; génère un bloc d'attestation avec `attested_by`, `attested_at` et un `nonce` ULID).

Fonctions utilitaires du moteur (dans `src/engine/`) :

- `envelope.ts` : analyse et rendu du frontmatter YAML.
- `schema-validator.ts` : validation par rapport au fichier `schemas/bridge-message.schema.json` en utilisant Ajv.
- `body-hash.ts` : calcul du hachage SHA-256 du corps normalisé selon la norme §4.1 (suppression du BOM, remplacement de CRLF par LF, suppression des espaces blancs de fin, présence exacte d'une seule nouvelle ligne à la fin).
- `status.ts` : dérivation de la classe de statut à partir du marqueur selon la norme §4.2 (`▶ active`, `⏸ pending`, `🎯 targeted`, `✅ completed`, `❌ cancelled`).
- `rig-id.ts` : validation de l'ID canonique de l'environnement au format kebab-case lors de l'entrée de la ligne de commande.
- `git.ts` : wrapper Git avec protections contre les sous-modules, la taille des fichiers et les éléments inutiles du système d'exploitation.
- `config.ts` : lecteur/rédacteur du fichier `.bridge/config.yaml`.
- `list-threads.ts` : énumère les threads ouverts à partir de l'arborescence de travail (pour la commande `status`).
- `peers.ts` : `findPeerRigs` : découvre les ID canoniques des environnements appairés à partir de l'historique des enveloppes (remplace la fonction `inferPeerRig` intégrée).
- `git-diff.ts` : `gitDiffSinceLastSync` : affiche les nouveaux fichiers depuis le dernier "pull" réussi (moteur de synchronisation).
- `hash-verify.ts` : `verifyHash` : recalcule et compare le hachage du corps pour vérifier l'intégrité de la chaîne `in_reply_to` (moteur de relais).
- `envelope-file.ts` : `validateEnvelopeFile` : analyse et valide un fichier par rapport au schéma en une seule opération (utilisé par les commandes `thread`, `sync` et `relay`).

**Livrables de la phase 0 (toujours pertinents) :**

- `docs/envelope-spec.md` — Spécification de l'enveloppe, propriété de rig-bridge (en-tête et contrat de corps indépendants du protocole de transport).
- `schemas/bridge-message.schema.json` — Schéma JSON 2020-12 pour l'en-tête de l'enveloppe (source de vérité pour la validation).
- `docs/control-plane-integration.md` — Conception "writes-through" pour l'intégration avec le plan de contrôle de `swarm-control-plane` (utilisation de SQLite, conception prospective ; surface v1.1).
- `docs/v1.1-roadmap.md` — Ce qui est inclus dans la version v1.1 : intégration du plan de contrôle, questions ouvertes soulevées par l'étude Phase 7 de swarm, et questions relatives à la surface d'examen en attente.
- `docs/cli-contract.md` — Contrat stable pour l'interface en ligne de commande (stdout/stderr, schéma `--json`, codes de sortie, variables d'environnement).
- `ARCHITECTURE.md` — Décision D2a-with-control-plane-bridge-glue + Référence croisée des schémas.

## Installation

### Depuis npm (v1.0.0+)

```bash
npm install -g @mcptoolshop/rig-bridge
```

> **Note :** Le paquet est actuellement en version de pré-sortie (`0.0.1-pre-swarm`). La version v1.0.0 sera publiée lors de la Phase 10 du prochain "dogfood swarm". En attendant, installez à partir du code source (voir ci-dessous).

### Depuis le code source

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### Vérification

```bash
rig-bridge --version
```

Cela devrait afficher la version enregistrée dans `package.json`.

### Environnements d'exécution pris en charge

- **Node:** `>= 20.11.0` (selon `package.json` `engines.node`)
- **npm:** `>= 10.0.0` (inclus avec Node `>= 20.11.0`)

### Plateformes prises en charge

macOS, Linux et Windows 10+ — les trois sont testés par l'intégration continue à chaque modification.

## Ce que cela deviendra

Une bibliothèque et une interface en ligne de commande qui permettent à deux (ou plusieurs) instances de Claude sur des machines différentes de se coordonner via un dépôt Git partagé, en utilisant un protocole d'enveloppe typé qui a fait ses preuves lors d'une session organique de 16 commits entre un Mac et une station de travail Windows équipée d'un GPU, le 29 avril 2026.

La version v1.0.0 inclut les 8 commandes en tant que fonctionnalité de base. La version v1.1 ajoute l'intégration du plan de contrôle, permettant ainsi à l'enveloppe d'écrire directement dans la base de données SQLite de `swarm-control-plane`, qui sert de couche de vérité durable — voir [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md).

Le protocole utilise sa propre enveloppe (indépendante du protocole de transport). Git est le lien entre les différentes machines ; dans la version v1.1, le plan de contrôle devient l'état durable.

## Contrat de l'interface en ligne de commande

rig-bridge suit la doctrine de [clig.dev](https://clig.dev/) : la sortie standard (stdout) représente les données, la sortie d'erreur standard (stderr) fournit des informations, et `--json` définit un contrat de stabilité. Consultez [`docs/cli-contract.md`](docs/cli-contract.md) pour la spécification complète : discipline de la sortie, schéma `--json` (`schema_version: "1.0"`), formats de sortie standard pour chaque commande, codes de sortie et variables d'environnement.

### Exemple d'utilisation

```bash
# Initialize the local clone on the GPU rig
rig-bridge init

# Open a new thread and send a typed REQUEST envelope
rig-bridge new bridge-onboarding-01
rig-bridge send REQUEST --thread bridge-onboarding-01

# Glance at what's open across all threads
rig-bridge status

# Pull from the peer rig (fast-forward only by default)
rig-bridge sync
```

Pour les applications qui consomment les données de manière programmatique, chaque commande accepte l'option `--json` :

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## Sécurité et données

- **Données concernées :** le clone local du dépôt de bridge + `.bridge/config.yaml` (identifiant de la machine + nom d'affichage facultatif) + fichiers de messages (markdown avec en-tête YAML). Aucune base de données. Aucun point de terminaison de télémétrie.
- **Flux de données sortants :** uniquement vers le dépôt Git configuré (GitHub via HTTPS par défaut). Aucun autre accès réseau.
- **Autorisations requises :** accès en lecture/écriture au dépôt local de bridge et au répertoire `.bridge/`; informations d'identification Git pour la publication (déléguées à la configuration Git existante de l'utilisateur).
- **Aucune télémétrie par défaut** — rig-bridge ne collecte, ne transmet ni ne conserve aucune donnée d'utilisation. La seule donnée qui quitte la machine locale sont les commits que l'utilisateur publie explicitement.
- **Modèle de confiance :** rig-bridge fait confiance à la sécurité TLS de GitHub pour l'intégrité du transport et à la configuration Git locale pour l'authentification. Les commandes `init`, `new`, `send`, `close`, `status`, `thread` et `sync` ne signent pas les commits elles-mêmes ; les utilisateurs peuvent ajouter la signature de commits GPG/SSH via les mécanismes Git existants. La commande `relay` est une exception : elle **nécessite** une clé de signature Git configurée (refuse les signatures non valides par conception, conformément au modèle de passerelle attestée par un humain) et enregistre l'identité du signataire dans le champ `attested_by` de l'enveloppe.

Consultez le fichier [SECURITY.md](SECURITY.md) pour signaler les vulnérabilités et connaître les versions prises en charge.

## Licence

MIT — voir [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
