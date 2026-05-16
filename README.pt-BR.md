<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**Status:** v1.0.x disponível no npm. **8 comandos de linha de comando (CLI)** (init / new / send / close / status / thread / sync / relay). Detecção de desvio entre diferentes configurações, comprovada através de testes de ponta a ponta (E2E) em diferentes configurações (transporte CRLF/LF, topologia de 3 configurações). A versão v1.1 incluirá a integração com o plano de controle.

Ferramenta de sincronização para ambientes de desenvolvimento emparelhados — entrega de pacotes tipados nativos do Git entre agentes.

## O que está disponível hoje

**Interface de transporte v1.0.x (completa):**

Todos os 8 comandos de linha de comando, além das funções auxiliares do motor que os suportam. A versão v1.0.x inclui o transporte Git separadamente — a integração com o plano de controle será adiada para a versão v1.1 (Caminho B-2; veja [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)).

Comandos para criação:

- `rig-bridge init` — inicializa o clone local, instala o hook de mensagem de commit e cria o arquivo `.bridge/config.yaml` com o ID canônico do ambiente.
- `rig-bridge new <thread-id>` — cria os arquivos `<thread-id>/REQUEST.md` a partir do modelo, com os metadados preenchidos.
- `rig-bridge send <type> --thread <id>` — cria um pacote tipado, valida-o em relação ao esquema, calcula o `body_hash`, deriva a `status_class` a partir do marcador e, em seguida, executa `git commit && git push`.
- `rig-bridge close <thread-id> --status <cancelled|completed>` — cria o arquivo `RESOLUTION.md`, faz o commit e envia as alterações.

Comandos de inspeção:

- `rig-bridge status` — lista as threads abertas com a última atividade, a classe de status, o tipo e o estado modificado; as opções `--json` e `--wide` exibem informações adicionais.
- `rig-bridge thread <id>` — exibe a transcrição completa do pacote para uma thread (layout de múltiplos gráficos, ordem cronológica ascendente, paginação automática no terminal).

Comandos de sincronização e autenticação:

- `rig-bridge sync` — sincronização rápida com detecção de divergências (recusa atualizações não rápidas sem a opção `--auto`; exibe as divergências nomeadas na fronteira da sincronização, de acordo com a semântica do Fossil).
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>` — confirmação humana de uma resposta/ACK (requer um sufixo `rig-id` com `-relay` e uma chave de assinatura Git configurada; emite um bloco de autenticação com `attested_by`, `attested_at` e um `nonce` ULID).

Funções auxiliares do motor (localizadas em `src/engine/`, reexportadas de `src/engine/index.ts` como a interface de consumo do plano de controle na versão v1.1):

- `envelope.ts` — Análise/renderização de metadados YAML.
- `schema-validator.ts` — Validação com base no Ajv, utilizando o arquivo `schemas/bridge-message.schema.json`.
- `body-hash.ts` — Cálculo de hash SHA-256 do corpo normalizado (CRLF→LF, remoção de espaços em branco no final, exatamente uma quebra de linha no final, remoção de BOM).
- `status.ts` — Derivação da classe de status a partir do marcador (por exemplo, `▶ ativo`, `⏸ pendente`, `🎯 direcionado`, `✅ concluído`, `❌ cancelado`).
- `rig-id.ts` — Validação do ID da configuração em formato kebab-case canônico + função auxiliar de entrada `normalizeRigId`.
- `git.ts` — Wrapper Git com proteções para submódulos, tamanho e informações específicas do sistema operacional (máximo de 50 MB no `spawnSync`).
- `config.ts` — Leitor/escritor do arquivo `.bridge/config.yaml` (normalização da quebra de linha antes da análise YAML para garantir a compatibilidade com autocrlf do Windows).
- `threads.ts` — `listThreads` — Lista as threads abertas a partir do diretório de trabalho (para o comando `status`).
- `peer-rigs.ts` — `findPeerRigs` — Descobre os IDs de configuração canônicos dos peers a partir do histórico do envelope (substitui o `inferPeerRig` inline).
- `git-diff.ts` — `gitDiffSinceLastSync` — Exibe os novos arquivos desde a última sincronização bem-sucedida (motor de sincronização; flag de elegibilidade para fast-forward).
- `verify-hash.ts` — `verifyHash` — Recalcula e compara o `body_hash` para garantir a integridade da cadeia `in_reply_to` (motor de retransmissão).
- `validate-file.ts` — `validateEnvelopeFile` — Analisa, valida com o esquema e verifica o hash em uma única chamada (compartilhado por `thread`, `sync` e `relay`).
- `index.ts` — Módulo de API pública estável; escritor do plano de controle v1.1 + os consumidores subsequentes importam a partir daqui.

**Entregas da Fase 0 (ainda válidas):**

- `docs/envelope-spec.md` — Especificação canônica do envelope, gerenciada pelo rig-bridge (estrutura de frontmatter e contrato de corpo independentes do protocolo de transporte).
- `schemas/bridge-message.schema.json` — Esquema JSON 2020-12 para a estrutura de frontmatter do envelope (fonte de verdade para validação).
- `docs/control-plane-integration.md` — Design de escrita direta para a integração com o `swarm-control-plane` usando SQLite (design prospectivo; superfície da versão 1.1).
- `docs/v1.1-roadmap.md` — O que a versão 1.1 inclui: escrita para o plano de controle, as questões pendentes levantadas pelo estudo da fase 7 do swarm e as questões de revisão que foram deixadas de lado.
- `docs/cli-contract.md` — Contrato estável da interface de linha de comando (CLI) (stdout/stderr, esquema `--json`, códigos de saída, variáveis de ambiente).
- `ARCHITECTURE.md` — Decisão D2a com ponte e "glue" do plano de controle + Referência cruzada de esquemas.

## Instalação

### Disponível no npm

```bash
npm install -g @mcptoolshop/rig-bridge
```

### A partir do código-fonte

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### Verificação

```bash
rig-bridge --version
```

Isso deve imprimir a versão registrada no arquivo `package.json`.

### Ambientes de execução suportados

- **Node:** `>= 20.11.0` (conforme especificado em `package.json` em `engines.node`).
- **npm:** `>= 10.0.0` (incluído com Node `>= 20.11.0`).

### Plataformas suportadas

macOS, Linux e Windows 10+ — todas as três são testadas pelo CI a cada "push".

## O que é

Uma biblioteca e uma interface de linha de comando (CLI) que permitem que duas (ou mais) instâncias do Claude em rigs diferentes se coordenem por meio de um repositório Git compartilhado, usando um protocolo de envelope tipado que foi testado em uma sessão orgânica de 16 commits entre um Mac e um rig com GPU Windows em 29 de abril de 2026.

A versão v1.0.x disponibiliza todos os 8 comandos como parte da interface de transporte. A versão v1.1 adicionará a integração com o plano de controle, permitindo que os envelopes sejam gravados no SQLite do `swarm-control-plane` como a camada de persistência — veja [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md).

O protocolo define seu próprio envelope (independente do protocolo de transporte). O Git é a conexão entre os rigs; na versão 1.1, o plano de controle se torna o estado persistente.

## Contrato da interface de linha de comando (CLI)

O rig-bridge segue a doutrina do [clig.dev](https://clig.dev): stdout é dados, stderr é informativo, `--json` é o contrato de estabilidade definido. Consulte [`docs/cli-contract.md`](docs/cli-contract.md) para a especificação completa — disciplina de saída, o esquema `--json` (`schema_version: "1.0"`), formatos stdout para cada comando, códigos de saída e variáveis de ambiente.

### Exemplo de uso

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

Para consumidores que usam scripts, cada comando aceita a opção `--json`:

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## Segurança e dados

- **Dados acessados:** o clone local do repositório do bridge + `.bridge/config.yaml` (identificador do rig + nome de exibição opcional) + arquivos de mensagem (Markdown com frontmatter YAML). Não há banco de dados. Não há pontos de coleta de dados (telemetria).
- **Tráfego de rede:** apenas para o repositório Git configurado (GitHub via HTTPS por padrão). Não há acesso à rede.
- **Permissões necessárias:** acesso de leitura/escrita ao repositório local do bridge e ao diretório `.bridge`; credenciais do Git para "push" (delegadas à configuração do Git existente do operador).
- **Sem coleta de dados por padrão** — o rig-bridge não coleta, transmite ou armazena nenhum dado de uso. Os únicos dados que saem da máquina local são os commits que o operador envia explicitamente.
- **Modelo de confiança:** o rig-bridge confia no TLS do GitHub para a integridade do transporte e na configuração do Git local para a autenticidade. Os comandos `init`, `new`, `send`, `close`, `status`, `thread` e `sync` não assinam os commits diretamente; os operadores podem adicionar assinaturas de commits GPG/SSH usando os mecanismos existentes do Git. O comando `relay` é uma exceção — ele **requer** uma chave de assinatura do Git configurada (recusa commits não assinados por design, de acordo com o modelo de gateway com validação humana) e registra a identidade do signatário no campo `attested_by` do envelope.

Consulte o arquivo [SECURITY.md](SECURITY.md) para informações sobre relatórios de vulnerabilidades e versões suportadas.

## Licença

MIT — veja o arquivo [LICENSE](LICENSE).

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
