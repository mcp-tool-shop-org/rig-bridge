<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**स्थिति:** चरण 7 (फ़ीचर निष्पादन लहर 2) पूरा हो गया। v1.0.0 ट्रांसपोर्ट सरफेस: **8 में से 8 CLI कमांड लागू** (init / new / send / close / status / thread / sync / relay)। ट्रांसपोर्ट सरफेस पूरा हो गया है; v1.1 में कंट्रोल-प्लेन एकीकरण शामिल है।

जोड़े गए डेवलपमेंट रिग्स के लिए क्रॉस-रिग सिंक टूल — गिट-नेटिव टाइप-एनवेलप क्रॉस-एजेंट हैंडऑफ।

## आज यहाँ क्या है

**v1.0.0 ट्रांसपोर्ट सरफेस पूरा:**

सभी 8 v1.0.0 CLI कमांड और उनके पीछे के इंजन हेल्पर। v1.0.0 गिट ट्रांसपोर्ट को स्वतंत्र रूप से प्रदान करता है — कंट्रोल-प्लेन एकीकरण को v1.1 (पाथ बी-2; देखें [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)) में स्थानांतरित कर दिया गया है।

कमांड बनाने:

- `rig-bridge init` — स्थानीय क्लोन को इनिशियलाइज़ करें, कमिट-मैसेज हुक स्थापित करें, और इस रिग की कैनोनिकल आईडी के साथ `.bridge/config.yaml` लिखें।
- `rig-bridge new <thread-id>` — एनवेलप टेम्पलेट से `<thread-id>/REQUEST.md` बनाएं, फ्रंटमैटर पहले से भरा हुआ।
- `rig-bridge send <type> --thread <id>` — एक टाइप एनवेलप लिखें, स्कीमा के विरुद्ध मान्य करें, `body_hash` की गणना करें, मार्कर से `status_class` प्राप्त करें, फिर `git commit && git push` करें।
- `rig-bridge close <thread-id> --status <cancelled|completed>` — `RESOLUTION.md` लिखें, कमिट करें, पुश करें।

निरीक्षण कमांड:

- `rig-bridge status` — अंतिम गतिविधि, स्टेटस क्लास, प्रकार और गंदे स्थिति के साथ खुले थ्रेड की सूची बनाएं; `--json` + `--wide` विकल्प उपलब्ध हैं।
- `rig-bridge thread <id>` — एक थ्रेड के लिए पूर्ण एनवेलप ट्रांसक्रिप्ट प्रदर्शित करें (छोटे-मल्टीपल लेआउट, कालानुक्रमिक क्रम में, TTY पर ऑटो-पेज)।

सिंक + अटैस्टेशन कमांड:

- `rig-bridge sync` — विचलन को उजागर करते हुए फास्ट-फॉरवर्ड पुल (गैर-FF को `--auto` के बिना अस्वीकार करता है; फॉसिल-शैली अर्थों के अनुसार सिंक सीमा पर नामित विचलन को उजागर करता है)।
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>` — मानव-प्रमाणित निर्णय/प्रतिक्रिया/स्वीकृति टर्न (एक `-relay` रिग-आई प्रत्यय + गिट साइनिंग कुंजी की आवश्यकता होती है; `attested_by` + `attested_at` + ULID `nonce` के साथ एक अटैस्टेशन ब्लॉक उत्सर्जित करता है)।

इंजन हेल्पर ( `src/engine/` में):

- `envelope.ts` — YAML फ्रंटमैटर पार्स/रेंडर।
- `schema-validator.ts` — `schemas/bridge-message.schema.json` के विरुद्ध Ajv-समर्थित सत्यापन।
- `body-hash.ts` — §4.1-मानकीकृत बॉडी पर SHA-256 (BOM हटाना, CRLF→LF, ट्रेलिंग-व्हाइटस्पेस ट्रिम, बिल्कुल एक टर्मिनल नई लाइन)।
- `status.ts` — मार्कर → `status_class` व्युत्पत्ति §4.2 के अनुसार (`▶ active`, `⏸ pending`, `🎯 targeted`, `✅ completed`, `❌ cancelled`)।
- `rig-id.ts` — CLI पर आने पर कैनोनिकल केबाब-केस रिग आईडी सत्यापन।
- `git.ts` — सबमॉड्यूल, आकार और OS-जंक गार्ड के साथ गिट रैपर।
- `config.ts` — `.bridge/config.yaml` रीडर/राइटर।
- `list-threads.ts` — कार्यशील ट्री से खुले थ्रेड को सूचीबद्ध करें ( `status` के लिए)।
- `peers.ts` — `findPeerRigs` — एनवेलप इतिहास से कैनोनिकल पीयर रिग-आईडी का पता लगाएं (इनलाइन `inferPeerRig` को बदलता है)।
- `git-diff.ts` — `gitDiffSinceLastSync` — अंतिम सफल पुल के बाद नई फ़ाइलों को उजागर करें (सिंक इंजन)।
- `hash-verify.ts` — `verifyHash` — `in_reply_to` श्रृंखला की अखंडता के लिए `body_hash` की पुनर्गणना करें और उसकी तुलना करें (रिले इंजन)।
- `envelope-file.ts` — `validateEnvelopeFile` — एक फ़ाइल पथ को एक कॉल में पार्स करें + स्कीमा-वैलिडेट करें ( `thread`, `sync`, `relay` द्वारा साझा)।

**चरण 0 डिलिवरेबल्स (अभी भी आधिकारिक):**

- `docs/envelope-spec.md` — 'एन्वलप' के लिए मानक विनिर्देश, जिसे rig-bridge द्वारा प्रबंधित किया जाता है (परिवहन-स्वतंत्र फ्रंटमैटर + बॉडी अनुबंध)।
- `schemas/bridge-message.schema.json` — 'एन्वलप' के फ्रंटमैटर के लिए JSON स्कीमा 2020-12 (सत्यापन का स्रोत)।
- `docs/control-plane-integration.md` — `swarm-control-plane` के SQLite के साथ 'राइट-थ्रू' डिज़ाइन (फॉरवर्ड डिज़ाइन; v1.1 संस्करण)।
- `docs/v1.1-roadmap.md` — v1.1 में क्या शामिल है: कंट्रोल-प्लेन राइट्स, फेज 7 अध्ययन 'स्वार्म' द्वारा उठाए गए प्रश्न, और 'पार्क्ड' समीक्षा प्रश्न।
- `docs/cli-contract.md` — स्थिर CLI (कमांड लाइन इंटरफेस) अनुबंध (stdout/stderr, `--json` स्कीमा, एग्जिट कोड, पर्यावरण चर)।
- `ARCHITECTURE.md` — D2a-with-control-plane-bridge-glue निर्णय + स्कीमा क्रॉस-रेफरेंस।

## इंस्टॉलेशन

### npm से (v1.0.0+)

```bash
npm install -g @mcptoolshop/rig-bridge
```

> **ध्यान दें:** यह पैकेज वर्तमान में प्री-रिलीज़ संस्करण (`0.0.1-pre-swarm`) है। v1.0.0 npm संस्करण अगले 'डॉगफूड' स्वार्म के फेज 10 में जारी किया जाएगा। तब तक, स्रोत से इंस्टॉल करें (नीचे दिया गया है)।

### स्रोत से

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### सत्यापित करें

```bash
rig-bridge --version
```

यह `package.json` में दर्ज संस्करण को प्रदर्शित करना चाहिए।

### समर्थित रनटाइम

- **Node:** `>= 20.11.0` (`package.json` के `engines.node` के अनुसार)
- **npm:** `>= 10.0.0` (Node `>= 20.11.0` के साथ बंडल किया गया)

### समर्थित प्लेटफॉर्म

macOS, Linux, और Windows 10+ — ये तीनों CI (निरंतर एकीकरण) द्वारा हर पुश पर जांचे जाते हैं।

## यह क्या होगा

एक CLI (कमांड लाइन इंटरफेस) + इंजन लाइब्रेरी जो दो (या अधिक) क्लाउड इंस्टेंस को अलग-अलग सिस्टम पर एक साझा Git रिपॉजिटरी के माध्यम से समन्वय करने की अनुमति देता है, एक 'टाइप्ड-एन्वलप' प्रोटोकॉल का उपयोग करके जो 2026-04-29 को एक मैक और एक विंडोज GPU सिस्टम के बीच 16 कमिट के एक 'ऑर्गेनिक' सत्र में पहली बार उपयोग किया गया था।

v1.0.0 में सभी 8 कमांड शामिल हैं। v1.1 में कंट्रोल-प्लेन एकीकरण जोड़ा गया है ताकि 'एन्वलप' `swarm-control-plane` के SQLite में लिखा जा सके, जो कि 'डूरबल ट्रुथ' लेयर है — [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md) देखें।

यह प्रोटोकॉल अपने स्वयं के 'एन्वलप' का उपयोग करता है (परिवहन-स्वतंत्र)। Git, विभिन्न सिस्टमों के बीच कनेक्शन स्थापित करने का माध्यम है; v1.1 में, कंट्रोल-प्लेन 'डूरबल स्टेट' बन जाता है।

## CLI अनुबंध

rig-bridge [clig.dev](https://clig.dev/) के सिद्धांतों का पालन करता है: stdout डेटा है, stderr विवरण है, `--json` एक स्थिर अनुबंध है। पूर्ण विनिर्देश के लिए [`docs/cli-contract.md`](docs/cli-contract.md) देखें — आउटपुट अनुशासन, `--json` स्कीमा (`schema_version: "1.0"`), प्रत्येक कमांड के लिए stdout प्रारूप, एग्जिट कोड और पर्यावरण चर।

### उदाहरण उपयोग

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

स्क्रिप्टेड उपयोगकर्ताओं के लिए, प्रत्येक कमांड `--json` स्वीकार करता है:

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## सुरक्षा और डेटा

- **डेटा:** bridge रिपॉजिटरी की स्थानीय प्रतिलिपि + `.bridge/config.yaml` (सिस्टम पहचानकर्ता + वैकल्पिक डिस्प्ले नाम) + संदेश फ़ाइलें (YAML फ्रंटमैटर के साथ मार्कडाउन)। कोई डेटाबेस नहीं। कोई टेलीमेट्री एंडपॉइंट नहीं।
- **नेटवर्क:** केवल कॉन्फ़िगर किए गए Git रिमोट (डिफ़ॉल्ट रूप से HTTPS के माध्यम से GitHub) पर। कोई अन्य नेटवर्क एक्सेस नहीं।
- **आवश्यक अनुमतियाँ:** स्थानीय bridge रिपॉजिटरी और `.bridge/` निर्देशिका तक पढ़ने/लिखने की पहुंच; पुश करने के लिए Git क्रेडेंशियल (ऑपरेटर के मौजूदा Git कॉन्फ़िगरेशन पर निर्भर)।
- **डिफ़ॉल्ट रूप से कोई टेलीमेट्री नहीं:** rig-bridge किसी भी उपयोग डेटा को एकत्र, प्रसारित या संग्रहीत नहीं करता है। केवल वही डेटा जो स्थानीय मशीन से बाहर जाता है, वह ऑपरेटर द्वारा स्पष्ट रूप से पुश किए गए कमिट हैं।
- **ट्रस्ट मॉडल:** rig-bridge परिवहन अखंडता के लिए GitHub TLS पर भरोसा करता है और लेखकत्व के लिए स्थानीय Git कॉन्फ़िगरेशन पर भरोसा करता है। `init`, `new`, `send`, `close`, `status`, `thread`, और `sync` कमांड स्वयं कमिट पर हस्ताक्षर नहीं करते हैं; ऑपरेटर मौजूदा Git तंत्रों के माध्यम से GPG/SSH कमिट हस्ताक्षर लागू कर सकते हैं। `relay` कमांड अपवाद है — इसके लिए एक कॉन्फ़िगर किए गए Git हस्ताक्षर कुंजी की **आवश्यकता** होती है (डिजाइन द्वारा बिना हस्ताक्षर के अस्वीकार कर दिया जाता है, मानव-प्रमाणित गेटवे मॉडल के अनुसार) और हस्ताक्षरकर्ता की पहचान को 'एन्वलप' के `attested_by` फ़ील्ड में रिकॉर्ड करता है।

सुरक्षा संबंधी जानकारी और समर्थित संस्करणों के बारे में जानने के लिए, [SECURITY.md](SECURITY.md) देखें।

## लाइसेंस

एमआईटी — [LICENSE](LICENSE) देखें।

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
