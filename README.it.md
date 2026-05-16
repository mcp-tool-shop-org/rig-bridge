<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**Stato:** La versione v1.0.x è disponibile su npm. **8 comandi CLI** (init / new / send / close / status / thread / sync / relay). Rilevamento della deriva tra diversi sistemi, testato tramite test end-to-end su più sistemi (trasporto CRLF/LF, topologia a 3 sistemi). La versione v1.1 prevede l'integrazione con il piano di controllo.

Strumento di sincronizzazione cross-rig per ambienti di sviluppo accoppiati: trasferimento di dati tra agenti tramite envelope tipizzati nativi di Git.

## Cosa è disponibile oggi

**Interfaccia di trasporto v1.0.x (completa):**

Tutti e 8 i comandi CLI, oltre alle funzioni di supporto del motore sottostanti. La versione v1.0.x include il trasporto Git separatamente; l'integrazione con il piano di controllo è prevista per la versione v1.1 (Percorso B-2; vedere [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)).

Comandi per la creazione:

- `rig-bridge init` — inizializza la copia locale, installa l'hook per i messaggi di commit e crea il file `.bridge/config.yaml` con l'ID univoco di questo ambiente.
- `rig-bridge new <thread-id>` — crea i file `<thread-id>/REQUEST.md` a partire dal modello, con i metadati iniziali precompilati.
- `rig-bridge send <type> --thread <id>` — crea un envelope tipizzato, lo valida rispetto allo schema, calcola l'hash del corpo, deriva la classe di stato dal marcatore, quindi esegue `git commit && git push`.
- `rig-bridge close <thread-id> --status <cancelled|completed>` — crea il file `RESOLUTION.md`, esegue il commit e l'invio.

Comandi per l'ispezione:

- `rig-bridge status` — elenca i thread aperti con l'ultima attività, la classe di stato, il tipo e lo stato modificato; opzioni `--json` e `--wide` per la visualizzazione.
- `rig-bridge thread <id>` — visualizza la trascrizione completa dell'envelope per un thread (layout a griglia, ordine cronologico ascendente, paginazione automatica nella console).

Comandi di sincronizzazione e attestazione:

- `rig-bridge sync` — esegue un pull fast-forward, mostrando le divergenze (rifiuta i pull non fast-forward a meno che non si utilizzi l'opzione `--auto`; mostra le divergenze nominate al limite della sincronizzazione, secondo la semantica di Fossil).
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>` — crea una risposta/conferma/accettazione attestata manualmente (richiede un suffisso `rig-id` con `-relay` e una chiave di firma Git configurata; genera un blocco di attestazione con `attested_by`, `attested_at` e un `nonce` ULID).

Funzioni di supporto del motore (presenti in `src/engine/`, riesportate da `src/engine/index.ts` come interfaccia di consumo del piano di controllo per la versione v1.1):

- `envelope.ts` — Analisi/generazione del frontmatter YAML.
- `schema-validator.ts` — Validazione basata su Ajv rispetto a `schemas/bridge-message.schema.json`.
- `body-hash.ts` — Calcolo dell'hash SHA-256 sul corpo normalizzato secondo la sezione 4.1 (CRLF→LF, rimozione degli spazi finali, esattamente una nuova riga finale, rimozione del BOM).
- `status.ts` — Derivazione della classe di stato da un marcatore secondo la sezione 4.2 (`▶ attivo`, `⏸ in attesa`, `🎯 mirato`, `✅ completato`, `❌ annullato`).
- `rig-id.ts` — Validazione dell'ID del sistema in formato kebab-case standard + funzione di supporto `normalizeRigId` per l'input.
- `git.ts` — Wrapper Git con protezioni per submodule, dimensione e elementi specifici del sistema operativo (buffer massimo di 50 MB durante `spawnSync`).
- `config.ts` — Lettore/scrittore di `.bridge/config.yaml` (normalizzazione della fine delle righe prima dell'analisi YAML per la compatibilità con Windows autocrlf).
- `threads.ts` — `listThreads` — Elenca i thread aperti dall'albero di lavoro (per `status`).
- `peer-rigs.ts` — `findPeerRigs` — Scopre gli ID dei sistemi peer standard dalla cronologia delle buste (sostituisce `inferPeerRig` inline).
- `git-diff.ts` — `gitDiffSinceLastSync` — Mostra i nuovi file dall'ultimo pull riuscito (motore di sincronizzazione; flag di idoneità per il fast-forward).
- `verify-hash.ts` — `verifyHash` — Ricalcola e confronta l'hash del corpo per l'integrità della catena `in_reply_to` (motore di relay).
- `validate-file.ts` — `validateEnvelopeFile` — Analizza, valida tramite schema e verifica l'hash in un'unica chiamata (utilizzato da `thread`, `sync`, `relay`).
- `index.ts` — Modulo principale dell'API pubblica stabile; scrittore del piano di controllo v1.1 + i moduli consumer downstream importano da qui.

**Deliverable della Fase 0 (ancora validi):**

- `docs/envelope-spec.md` — specifica dell'inviluppo di riferimento, gestita da rig-bridge (intestazione e contratto del corpo indipendenti dal protocollo di trasporto).
- `schemas/bridge-message.schema.json` — Schema JSON 2020-12 per l'intestazione dell'inviluppo (fonte di verità per la validazione).
- `docs/control-plane-integration.md` — progettazione "writes-through" per l'integrazione con il database SQLite di `swarm-control-plane` (progettazione orientata al futuro; funzionalità della versione 1.1).
- `docs/v1.1-roadmap.md` — funzionalità incluse nella versione 1.1: scrittura nel control plane, risoluzione delle domande sollevate dallo studio di Phase 7 di swarm, e gestione delle domande in sospeso relative all'interfaccia utente.
- `docs/cli-contract.md` — contratto stabile per l'interfaccia a riga di comando (CLI) (stdout/stderr, schema `--json`, codici di uscita, variabili d'ambiente).
- `ARCHITECTURE.md` — decisione sull'architettura D2a con bridge e glue, e riferimento incrociato agli schemi.

## Installazione

### Disponibile su npm

```bash
npm install -g @mcptoolshop/rig-bridge
```

### Dal codice sorgente

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### Verifica

```bash
rig-bridge --version
```

Questo comando dovrebbe stampare la versione indicata nel file `package.json`.

### Sistemi operativi supportati

- **Node:** `>= 20.11.0` (specificato in `package.json` nella sezione `engines.node`).
- **npm:** `>= 10.0.0` (incluso con Node `>= 20.11.0`).

### Piattaforme supportate

macOS, Linux e Windows 10+ — tutte e tre le piattaforme sono testate tramite CI ad ogni commit.

## Cos'è

Una libreria e un'interfaccia a riga di comando (CLI) che consentono a due (o più) istanze di Claude su rig diversi di coordinarsi tramite un repository Git condiviso, utilizzando un protocollo di inviluppo tipizzato che ha superato il primo contatto durante una sessione organica di 16 commit tra un Mac e un rig GPU Windows il 29 aprile 2026.

La versione v1.0.x include tutti e 8 i comandi come interfaccia di trasporto. La versione v1.1 aggiungerà l'integrazione con il piano di controllo, in modo che le buste vengano scritte in SQLite di `swarm-control-plane` come livello di verità duratura; vedere [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md).

Il protocollo gestisce il proprio inviluppo (indipendente dal protocollo di trasporto). Git è il collegamento tra i rig; nella versione 1.1, il control plane diventa lo stato persistente.

## Contratto dell'interfaccia a riga di comando (CLI)

rig-bridge segue la filosofia di [clig.dev](https://clig.dev): stdout rappresenta i dati, stderr fornisce informazioni, e `--json` definisce un contratto di stabilità. Consultare [`docs/cli-contract.md`](docs/cli-contract.md) per la specifica completa: disciplina dell'output, schema `--json` (`schema_version: "1.0"`), formati stdout per ogni comando, codici di uscita e variabili d'ambiente.

### Esempio di utilizzo

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

Per i consumatori che utilizzano script, ogni comando accetta l'opzione `--json`:

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## Sicurezza e dati

- **Dati coinvolti:** la copia locale del repository di bridge + `.bridge/config.yaml` (identificativo del rig + nome visualizzato opzionale) + file di messaggi (markdown con intestazione YAML). Nessun database. Nessun endpoint di telemetria.
- **Traffico di rete in uscita:** solo verso il repository Git configurato (GitHub tramite HTTPS per impostazione predefinita). Nessun altro accesso alla rete.
- **Permessi richiesti:** accesso in lettura/scrittura al repository di bridge locale e alla directory `.bridge`; credenziali Git per l'invio (delegate alla configurazione Git esistente dell'utente).
- **Nessuna telemetria predefinita** — rig-bridge non raccoglie, trasmette o memorizza alcun dato di utilizzo. L'unico dato che lascia la macchina locale sono i commit che l'utente invia esplicitamente.
- **Modello di fiducia:** rig-bridge si fida della crittografia TLS di GitHub per l'integrità del trasporto e della configurazione Git locale per l'autenticazione. I comandi `init`, `new`, `send`, `close`, `status`, `thread` e `sync` non firmano i commit; gli utenti possono implementare la firma dei commit tramite GPG/SSH utilizzando i meccanismi Git esistenti. Il comando `relay` è un'eccezione: **richiede** una chiave di firma Git configurata (rifiuta le firme non valide per progettazione, in base al modello di gateway con autenticazione umana) e registra l'identità del firmatario nel campo `attested_by` dell'inviluppo.

Consultare il file [SECURITY.md](SECURITY.md) per le segnalazioni di vulnerabilità e le versioni supportate.

## Licenza

MIT — vedere [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
