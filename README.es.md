<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**Estado:** v1.0.x disponible en npm. **8 comandos de la interfaz de línea de comandos (CLI)** (init / new / send / close / status / thread / sync / relay). La detección de deriva entre diferentes configuraciones (cross-rig) ha sido probada mediante pruebas de extremo a extremo (E2E) en diferentes configuraciones (transporte CRLF/LF, topología de 3 configuraciones). La versión 1.1 incluirá la integración con el plano de control.

Herramienta de sincronización para configuraciones de desarrollo emparejadas: entrega de sobres tipados nativos de Git entre agentes.

## ¿Qué hay aquí hoy?

**Interfaz de transporte v1.0.x (completa):**

Los 8 comandos de la CLI, junto con las funciones auxiliares del motor que los respaldan. La versión 1.0.x incluye el transporte de Git por separado; la integración con el plano de control se pospone para la versión 1.1 (Ruta B-2; consulte [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)).

Comandos para la creación:

- `rig-bridge init`: inicializa el clon local, instala el gancho de mensaje de confirmación y escribe `.bridge/config.yaml` con el ID canónico de esta configuración.
- `rig-bridge new <thread-id>`: crea el archivo `<thread-id>/REQUEST.md` a partir de la plantilla de sobre, con el frontmatter pre-completado.
- `rig-bridge send <type> --thread <id>`: escribe un sobre tipado, valida contra el esquema, calcula el `body_hash`, deriva la `status_class` a partir del marcador y luego ejecuta `git commit && git push`.
- `rig-bridge close <thread-id> --status <cancelled|completed>`: escribe `RESOLUTION.md`, confirma y envía.

Comandos de inspección:

- `rig-bridge status`: lista los hilos abiertos con la última actividad, la clase de estado, el tipo y el estado modificado; las opciones `--json` y `--wide` muestran la información en formato JSON y con un formato más amplio, respectivamente.
- `rig-bridge thread <id>`: muestra la transcripción completa del sobre para un hilo (disposición de múltiples elementos, orden cronológico ascendente, paginación automática en la terminal).

Comandos de sincronización y verificación:

- `rig-bridge sync`: realiza una operación de "fast-forward pull" y muestra las divergencias (rechaza las operaciones que no son "fast-forward" a menos que se use la opción `--auto`; muestra las divergencias con nombre en el límite de sincronización, según la semántica de Fossil).
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>`: permite la verificación humana de las respuestas/confirmaciones/respuestas (requiere un sufijo de ID de configuración `-relay` y una clave de firma de Git configurada; emite un bloque de verificación con `attested_by` + `attested_at` + un `nonce` de tipo ULID).

Funciones auxiliares del motor (ubicadas en `src/engine/`, y re-exportadas desde `src/engine/index.ts` como la interfaz de consumidor del plano de control en la versión 1.1):

- `envelope.ts`: análisis/renderizado del frontmatter YAML.
- `schema-validator.ts`: validación basada en Ajv contra `schemas/bridge-message.schema.json`.
- `body-hash.ts`: cálculo del hash SHA-256 del cuerpo normalizado según la sección 4.1 (CRLF→LF, eliminación de espacios en blanco finales, exactamente una nueva línea al final, eliminación de BOM).
- `status.ts`: derivación de la `status_class` a partir del marcador según la sección 4.2 (`▶ active`, `⏸ pending`, `🎯 targeted`, `✅ completed`, `❌ cancelled`).
- `rig-id.ts`: validación del ID de configuración en formato kebab-case y función auxiliar `normalizeRigId` para la entrada.
- `git.ts`: envoltorio de Git con protecciones para submódulos, tamaño y elementos innecesarios del sistema operativo (máximo `Buffer` de 50 MB al usar `spawnSync`).
- `config.ts`: lector/escritor de `.bridge/config.yaml` (normalización de los saltos de línea antes del análisis YAML para evitar problemas con autocrlf de Windows).
- `threads.ts`: `listThreads`: enumera los hilos abiertos desde el árbol de trabajo (para `status`).
- `peer-rigs.ts`: `findPeerRigs`: descubre los ID de configuración de los pares canónicos a partir del historial de sobres (reemplaza la función `inferPeerRig` integrada).
- `git-diff.ts`: `gitDiffSinceLastSync`: muestra los archivos nuevos desde la última operación de "pull" exitosa (motor de sincronización; indicador de elegibilidad para "fast-forward").
- `verify-hash.ts`: `verifyHash`: vuelve a calcular y compara el `body_hash` para la integridad de la cadena `in_reply_to` (motor de "relay").
- `validate-file.ts`: `validateEnvelopeFile`: analiza, valida contra el esquema y verifica el hash en una sola llamada (compartido por `thread`, `sync` y `relay`).
- `index.ts`: "barrel" de la API pública estable; escritor del plano de control de la versión 1.1 y los consumidores posteriores importan desde aquí.

**Entregables de la Fase 0 (todavía son la versión autorizada):**

- `docs/envelope-spec.md` — Especificación canónica del sobre, propiedad de rig-bridge (metadatos independientes del protocolo de transporte + contrato del cuerpo).
- `schemas/bridge-message.schema.json` — Esquema JSON 2020-12 para los metadatos del sobre (fuente de verdad para la validación).
- `docs/control-plane-integration.md` — Diseño de escritura directa a través de SQLite de `swarm-control-plane` (diseño prospectivo; superficie de la versión 1.1).
- `docs/v1.1-roadmap.md` — Lo que incluye la versión 1.1: escritura en el plano de control, las preguntas pendientes planteadas por el estudio de la fase 7 de swarm, y las preguntas sobre la interfaz que quedaron pendientes.
- `docs/cli-contract.md` — Contrato estable de la interfaz de línea de comandos (CLI) (salida estándar/error estándar, esquema `--json`, códigos de salida, variables de entorno).
- `ARCHITECTURE.md` — Decisión D2a con puente y capa de control + Referencia cruzada de esquemas.

## Instalación

### Desde npm

```bash
npm install -g @mcptoolshop/rig-bridge
```

### Desde el código fuente

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### Verificación

```bash
rig-bridge --version
```

Esto debería imprimir la versión registrada en `package.json`.

### Entornos de ejecución compatibles

- **Node:** `>= 20.11.0` (según `package.json` `engines.node`)
- **npm:** `>= 10.0.0` (incluido con Node `>= 20.11.0`)

### Plataformas compatibles

macOS, Linux y Windows 10+; las tres se prueban mediante CI en cada actualización.

## ¿Qué es?

Una biblioteca y una interfaz de línea de comandos (CLI) que permiten que dos (o más) instancias de Claude en diferentes sistemas coordinen a través de un repositorio de Git compartido, utilizando un protocolo de sobres con tipo que superó el primer contacto en una sesión orgánica de 16 confirmaciones entre un sistema Mac y un sistema con GPU de Windows el 29 de abril de 2026.

La versión 1.0.x incluye los 8 comandos como parte del transporte. La versión 1.1 agregará la integración con el plano de control para que el sobre se escriba directamente en SQLite de `swarm-control-plane` como la capa de verdad duradera; consulte [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md).

El protocolo tiene su propio sobre (independiente del protocolo de transporte). Git es la conexión entre los diferentes sistemas; en la versión 1.1, el plano de control se convierte en el estado duradero.

## Contrato de la interfaz de línea de comandos (CLI)

rig-bridge sigue la doctrina de [clig.dev](https://clig.dev): la salida estándar es datos, el error estándar es una descripción, y `--json` es el contrato de estabilidad definido. Consulte [`docs/cli-contract.md`](docs/cli-contract.md) para la especificación completa: disciplina de la salida, el esquema `--json` (`schema_version: "1.0"`), la estructura de la salida estándar para cada comando, los códigos de salida y las variables de entorno.

### Uso de ejemplo

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

Para los consumidores que utilizan scripts, cada comando acepta `--json`:

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## Seguridad y datos

- **Datos accedidos:** la copia local del repositorio de bridge + `.bridge/config.yaml` (identificador del sistema + nombre para mostrar opcional) + archivos de mensajes (Markdown con metadatos YAML). No hay base de datos. No hay puntos finales de telemetría.
- **Salida de red:** solo a la ubicación remota de Git configurada (GitHub a través de HTTPS de forma predeterminada). No hay otro acceso a la red.
- **Permisos requeridos:** acceso de lectura/escritura al repositorio local de bridge y al directorio `.bridge`; credenciales de Git para enviar (delegadas a la configuración de Git existente del operador).
- **No hay telemetría de forma predeterminada:** rig-bridge no recopila, transmite ni almacena ningún dato de uso. Los únicos datos que salen de la máquina local son las confirmaciones que el operador envía explícitamente.
- **Modelo de confianza:** rig-bridge confía en el TLS de GitHub para la integridad del transporte y confía en la configuración de Git local para la autoría. Los comandos `init`, `new`, `send`, `close`, `status`, `thread` y `sync` no firman las confirmaciones por sí mismos; los operadores pueden implementar la firma de confirmaciones GPG/SSH a través de los mecanismos de Git existentes. El comando `relay` es una excepción: **requiere** una clave de firma de Git configurada (se niega a aceptar confirmaciones no firmadas, según el modelo de puerta de enlace con certificación humana) y registra la identidad del firmante en el campo `attested_by` del sobre.

Consulte [SECURITY.md](SECURITY.md) para informar sobre vulnerabilidades y ver las versiones compatibles.

## Licencia

MIT — consulte [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
